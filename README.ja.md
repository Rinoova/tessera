# Tessera

[English](README.md) · [Italiano](README.it.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt.md) · [简体中文](README.zh-Hans.md) · **日本語**

**同じフォルダーで作業する複数のローカル AI コーディングエージェントのための、低レベルかつ依存ゼロの協調機構。**

複数の [Claude Code](https://docs.claude.com/en/docs/claude-code) エージェントを同じリポジトリ上で同時に実行すると、そのうちの 2 つが同じファイルを同時に編集し、互いの作業を黙って上書きしてしまうことがあります。Tessera は、予測不能なタイミングで起動されるエージェント同士が**リアルタイムで互いを発見し**、**互いの足を踏み合うのをやめる**ことを可能にします — フォルダー単位で、デーモン不要、クラッシュ耐性を備え、あらゆるプロジェクト（ポリレポ、モノレポ、単一リポジトリ、任意の言語）に対応します。

> **なぜ「Tessera」なのか？** *tessera* とは、モザイクを構成する 1 枚のタイルのことです。*tessellation*（テッセレーション、敷き詰め）では、タイルが**隙間なく重なりなく**面を覆います — これはまさにここでの目標と一致します。多数のエージェントが作業を敷き詰め、決して重ならない。各エージェントが 1 つの tessera であり、共有バスがモザイク全体です。

## アイデアを一行で

エージェント間の競合には 3 つの種類があり、それぞれにはすでに適切なツールが存在します — そこで Tessera は、薄い接着層と、本当に欠けている 1 つのピースだけを構築します。

| 種類 | 適切なツール | Tessera |
|---|---|---|
| **追跡対象ファイル**（git 管理下） | `git worktree` による隔離 + 本物の `git merge` | それを**採用する**（`up --isolated`） |
| **アウェアネス** — 誰がここにいるか、何に触れているか、たった今誰かが起動したか | スコープ単位の追記専用 **NDJSON バス** + Claude **hooks** + `fs.watch` | **構築する**（薄く） — デフォルト |
| **git がマージできない、本当に共有されたファイル**（gitignore された env、生成された singleton） | `flock(2)` ロック + アトミック書き込み | **計画中**（オプトインの flock モード — 本リリースには含まれません） |

ベクタークロックは不要です（単一ホスト上では、1 つの追記専用ファイルの**バイトオフセットがすでに全順序を成す**ため）。デーモンも不要。アイドルコストもゼロ。プリミティブのレベルでは何も発明しておらず、`git`、`flock`、`inotify`（`fs.watch` 経由）、`tmux`、そして NDJSON を組み合わせているだけです。

## なぜフォルダー単位のスコープ分離が自動的に働くのか

協調のための媒体（`<scope>/.tessera/`）はプロジェクトの*内部*に存在するため、2 つのエージェントが媒体を共有するのは、それらが触れるパスが同じスコープへと解決される**場合に限られます**。異なるプロジェクトにいるエージェント同士は何も共有せず、互いに不可視です — 何のコストもなく。（これは Linda のタプル空間における「局所的な法則、大域的な効果」という性質です。）`scope` とは、マーカー（`.tessera-scope`、`.git`、`package.json`、`go.mod`、`pyproject.toml`、`Cargo.toml`、…）を持つ最も近い祖先であり、距離を優先するため、モノレポのサブツリーは独立を保ちます。

## インストール

```bash
git clone <repo-url> tessera && cd tessera
node bin/tessera.mjs install --global      # merge hooks into ~/.claude/settings.json (auto-backed-up); fires everywhere
# dormant (~ms sh pre-filter) in every project until one opts in:
node bin/tessera.mjs install --scope .      # opt THIS project in (creates .tessera/, gitignores it)
node bin/tessera.mjs install --uninstall    # remove the hooks (the skill dir and per-scope .tessera/ are left in place)
```
**要件:** Linux、**node ≥18**、[Claude Code](https://docs.claude.com/en/docs/claude-code) CLI、そして `git`。`tmux` はオプションです（ない場合、ランチャーはデタッチされた spawn にフォールバックします）。`tessera` を直接実行するには、リポジトリ内で `npm link`（または `npm install -g .`）を実行するか — `bin` フィールドはすでに設定済みです — あるいは `bin/tessera.mjs` を `PATH` 上にシンボリックリンクしてください。インストールすべき npm 依存関係はありません。

## 使い方 — 多数のエージェントを起動して監視する

```bash
tessera up --task "split the API module" -n 3      # 3 agents, SHARED checkout, awareness + overlap warnings
tessera up --task "migrate to v2" -n 5 --isolated   # 5 agents, each in its own git worktree+branch
tessera up --task "..." -n 3 --dry-run              # preview predicted collisions, don't launch
tessera ps --follow                                 # real-time dashboard: who's live, what they touch, overlaps
tessera ps --all                                    # every participating scope under cwd
tessera kill wave1.2                                # safe teardown (tmux window / process group)
tessera doctor                                      # health check
```

## 自動的に得られるもの（Claude hooks 経由 — エージェントの協力は不要）

- **SessionStart** → 各エージェントは自分自身をアナウンスし、*「ここでは他に N 個のエージェントがアクティブで、X、Y に触れています」*と知らされます。
- **PreToolUse(Edit/Write/NotebookEdit)** → 各エージェントが何を編集するかを記録します。生存中のピアが**同じファイル**に触れている場合、編集中のエージェントは協調のための警告を受け取ります（あるいは `TESSERA_GUARD=1` のもとではハードブロックされます）。
- **Stop / SessionEnd** → ハートビート / 解放。

協調の単位は**エージェントセッション**（別個の `claude` 呼び出し）です。バスは追記専用で、クラッシュ耐性があり（先頭の `\n` フレーミングが破損した書き込みを自己修復します）、プロトタイプ汚染に対して安全で、重複排除されています。アイデンティティは session id であり、生存性はハートビート + （判明している場合は）`/proc` です。

## 保証の範囲

単一の Linux ホスト、1 つの uid、ローカルファイルシステム（アドバイザリーロックと inotify は NFS 上では信頼できません）。Tessera は**データ整合性**と**正しいティアダウンの対象指定**を守ります。一方で、悪意のある同一 uid のプロセスに対しては防御**せず**、秘密の*値*そのものを保護することも**しません** — これははっきりと述べておくべき点であり、できるふりはしません。*異なるマシン*をまたいでエージェントを協調させることは計画中のオプション層です（メッシュ VPN 上のネットワークトランスポート）。現時点では、ローカルファイルバスがすべてであり、それは意図的なものです。

## レイアウト

```
lib/      scope · identity · bus · proc · coord · config · args
hooks/    tessera-hook.sh (fast pre-filter) → tessera-hook.mjs (handler)
cmd/      install · up · ps · kill · doctor
bin/      tessera.mjs
test/     selftest.mjs · dummy-agent.mjs
docs/     DESIGN.md
```

## ライセンス

MIT。コントリビューション歓迎です。
