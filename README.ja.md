# Tessera

[English](README.md) · [Italiano](README.it.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt.md) · [简体中文](README.zh-Hans.md) · **日本語**

<p align="center"><img src="docs/img/hero.png" alt="Tessera — 多数のエージェント、1つの共有フォルダ、衝突なし" width="840"></p>

Tessera を使えば、**複数のローカル AI コーディングエージェントを同じフォルダで同時に**動かしながら、互いの作業を黙って上書きし合うことを防げます。とても小さく（依存ゼロ）、どんなプロジェクトでも動作し、バックグラウンドサービスも不要です。協調動作は、共有ファイル 1 つと [Claude Code](https://docs.claude.com/en/docs/claude-code) の hooks に乗って実現されます。

> **一度インストールすれば、あとは忘れていいスキル。** Tessera はスキル + hooks として Claude Code に組み込まれます。これを使わないプロジェクトでは、何もしない数ミリ秒のシェルチェックにすぎません。使うプロジェクトでも、エージェントが意識すべき作業は何も増えません。エージェントは Tessera がそこにあることすら知る必要がないのです。

> **名前について。** *tessera* とは、モザイクを構成する 1 枚のタイルのことです。*tessellation*（タイル張り）では、タイルが面を **隙間なく、重なりなく** 覆います。まさに、多数のエージェントが 1 つのコードベースを共有するときに求められる状態です。

---

## 問題

同じリポジトリで 2 つか 3 つのエージェントを起動すると、次の順で問題にぶつかります。

1. **黙った上書き。** 2 つのエージェントが同じファイルを同じ瞬間に編集します。後から保存した方が勝ち、最初のエージェントの作業は消えます。しかもエラーは出ません。
2. **可視性の欠如。** 誰が何に触れているのか見えません。衝突に気づくのは後になってから、マージコンフリクトやビルド破壊の時点です。
3. **予測できない起動。** エージェントはその場その場で（あなた自身や、別のエージェントによって）起動されます。すでに作業中のエージェントには、新参者が到着したことを知らせるものが何もありません。
4. **既存ツールは問題を回避するだけ。** ほとんどのマルチエージェントランナーは、各エージェントにそれぞれの *git worktree* を与え、後から `git merge` に始末をつけさせます。完全に独立した作業には最適ですが、エージェントが **1 つの共有チェックアウトの中で** 協調しなければならない場合には役に立ちません。

<img src="docs/img/problem.png" alt="2 つのエージェントが同じファイルを同時に編集し、一方がもう一方を黙って上書きする" width="840">

<p align="center"><sub><i>2 つのエージェントが同じ瞬間に <code>src/api.js</code> を保存すると、後の書き込みが勝ち、最初のエージェントの作業は消え、しかも何の警告もありません。</i></sub></p>

---

## アイデア: 共有ボード

1 つの部屋で作業するチームを想像してください。壁にはボードが掛かっています。誰かがタスクを始めるたびに、それを書き出します。*「私は `api.js` を担当中」* というように。そして全員が、ファイルを取りに行く前にボードをちらっと確認します。

**Tessera はあなたのエージェントのための、そのボードです。** これはプロジェクトの *内側* に（`<project>/.tessera/` として）、シンプルな追記専用ログとして存在します。各エージェントは自分の存在を告げ、何を編集しているかを書き込みます。他のすべてのエージェントはそれをリアルタイムで読み取ります。2 つが同じファイルに手を伸ばすと、これから書き込もうとしている方に注意が促されます。

<img src="docs/img/blackboard.png" alt="各エージェントが編集中の内容を書き込み、仲間がリアルタイムで読み取る共有ボード" width="840">

<p align="center"><sub><i>各エージェントが編集中の内容を投稿します。新参者の D が A のファイルに手を伸ばすと、ボードがすぐに衝突を示すので、衝突する代わりに協調できます。</i></sub></p>

どのエージェントも Tessera を *知る* 必要も、意図的に協力する必要もありません。すべては Claude Code の hooks を通じて配線されているからです（下記の **しくみ** を参照）。

---

## フォルダごとのスコープ — プロジェクト間のノイズなし

ボードはプロジェクトの *内側* に存在するので、そのプロジェクトを実際に共有するエージェントだけをつなぎます。別々の 2 つのリポジトリにいる 2 つのエージェントは、2 つの別々のボードに書き込み、**互いに見えません**。モノレポのサブプロジェクトも、それぞれ独立を保ちます。

<img src="docs/img/scopes.png" alt="2 つのプロジェクトがそれぞれ独自のボードを持ち、異なるプロジェクトのエージェントは互いに見えない" width="840">

<p align="center"><sub><i>2 つのプロジェクト、2 つのボード。異なるフォルダのエージェントは何も共有せず、互いを決して見ません。ノイズもなければ、誤報もありません。</i></sub></p>

*スコープ* とは、ツリーを上にたどって最も近い、マーカー（`.git`、`package.json`、`go.mod`、`pyproject.toml`、`Cargo.toml`、…、または明示的な `.tessera-scope`）を持つフォルダのことです。エージェントは、自分が触れるパスが **同じ** スコープに収まるところでのみ協調します。

---

## しくみ（内部の動き）

Tessera は意図的に小さく作られています。それは 1 つの観察に基づいています。**衝突には 3 種類あり、そのうち 2 つにはすでに優れたツールがある** ということです。

| ファイルの種類 | 適切なツール | Tessera の役割 |
|---|---|---|
| **追跡対象ファイル**（git 管理下） | `git worktree` による隔離 + 本物の `git merge` | **採用する** — `tessera up --isolated` が各エージェントに専用の worktree + ブランチを与える |
| **可視性**（誰がいて、何に触れているか） | *軽量なものは存在しなかった* | **作る** — 共有ボード（デフォルトモード） |
| **git がマージできない共有ファイル**（gitignore された env、生成されたシングルトン） | `flock` + アトミックな書き込み | **計画中**（オプトインの flock モード）、本リリースには含まれない |

つまり Tessera は、欠けている薄い 1 ピース、すなわち *可視性* だけを作り、残りには `git`、`flock`、`inotify`（Node の `fs.watch` 経由）、`tmux`、NDJSON を再利用します。**ベクトルクロックはありません**（1 台のマシン上では、追記専用ファイル 1 つがすでに全順序です）。**デーモンもなく**、**アイドル時のコストもありません**。

<img src="docs/img/flow.png" alt="ライフサイクル: エージェントは開始時に自分を告げ、編集前にボードを確認し、その後協調する" width="840">

<p align="center"><sub><i>ループ全体は自動です。開始時に自分を告げ、編集前にボードを確認し、衝突時に協調する。すべては hooks によって駆動され、エージェントには見えません。</i></sub></p>

好奇心のために、いくつかの具体的な点を挙げます。

- **ボードが信頼できる唯一の情報源。** 追記専用 NDJSON。途切れた書き込みは自己修復し（各レコードは先頭の改行で枠づけされる）、リーダーは重複排除され、プロトタイプ汚染にも安全です。`fs.watch` は単なる *呼び鈴* にすぎません。エージェントは常にログと突き合わせて整合をとります。
- **アイデンティティ = セッション。** 別個の `claude` 実行が 1 つのエージェントであり、その配下のサブエージェントはその単一の作業単位です（Claude はすでにそれらのファイルを分けています）。生存確認はハートビート、加えて分かる場合は `/proc` です。
- **ゲートは hook。** `PreToolUse` は、書き込みが着地する *前に*、警告を出す、あるいは `TESSERA_GUARD=1` の下では強制ブロックすることができます。すべてはユーザー空間で完結します（特権も `fanotify` も不要）。

📖 **さらに深く:** あらゆる選択の背後にある完全な論拠 — 何を試して何を退けたか、そしてなぜ高速で軽量なままなのか — は **[docs/RATIONALE.md](docs/RATIONALE.md)** にあります。

---

## インストール

```bash
git clone <repo-url> tessera && cd tessera
node bin/tessera.mjs install --global      # add the hooks to ~/.claude/settings.json (auto-backed-up); fires everywhere
# dormant (~ms shell pre-filter) in every project until one opts in:
node bin/tessera.mjs install --scope .      # opt THIS project in (creates .tessera/, gitignores it)
node bin/tessera.mjs install --uninstall    # remove the hooks (the skill dir and per-scope .tessera/ are left in place)
```

**要件:** Linux、**node ≥18**、[Claude Code](https://docs.claude.com/en/docs/claude-code) CLI、そして `git`。`tmux` は任意です（なければランチャーはデタッチされた spawn にフォールバックします）。`tessera` を直接使うには、リポジトリ内で `npm link`（または `npm install -g .`）を実行するか、`bin/tessera.mjs` を `PATH` 上にシンボリックリンクしてください。インストールすべき **npm 依存はありません**。

## 使い方

```bash
tessera up --task "split the API module" -n 3      # 3 agents, SHARED checkout: awareness board + overlap warnings
tessera up --task "migrate to v2" -n 5 --isolated   # 5 agents, each in its own git worktree + branch
tessera up --task "..." -n 3 --dry-run              # preview the predicted collisions, don't launch
tessera ps --follow                                 # live dashboard: who's active, what they touch, overlaps
tessera ps --all                                    # every participating scope under the current folder
tessera kill wave1.2                                # safe teardown (tmux window / process group)
tessera doctor                                      # health check
```

## 自動的に得られるもの

いったんインストールすれば、どのように起動されたエージェントであっても、追加の手間なく参加します。

- **開始時** → 自分の存在を告げ、*「ここでは他に N 個のエージェントが稼働中で、X、Y に触れている」* と伝えられます。
- **各編集の前**（`Edit` / `Write` / `NotebookEdit`）→ 何に触れているかを記録します。稼働中の仲間が **同じファイル** にいる場合は、協調を促す警告を受け取ります（`TESSERA_GUARD=1` の下では強制ブロック）。
- **停止・終了時** → ハートビートと解放。

## 保証と限界

単一の Linux ホスト、1 ユーザー、ローカルファイルシステム（advisory ロックと inotify は NFS 上では信頼できません）。Tessera は **データの整合性** と **正しいティアダウン対象の指定** を守ります。同一ユーザーの悪意あるプロセスから守ることはしませんし、秘密の *値* を保護することもしません。これは取り繕わず、はっきりと述べておきます。*異なるマシン* にまたがってエージェントを協調させることは、計画中のオプション層です（メッシュ VPN 上のネットワークトランスポート）。今日のところは、意図的にローカルボードがすべてです。[`docs/ROADMAP.md`](docs/ROADMAP.md) と [`docs/DESIGN.md`](docs/DESIGN.md) を参照してください。

## 関連研究

隔離優先のランナー（**uzi**、**claude-squad**、**vibe-kanban**、**Conductor**）は、各エージェントに独自の worktree／ワークスペースを与え、衝突は `git merge` に先送りします。**claude-flow** は、*それ自身* がオーケストレーションするサブエージェントを、重厚な共有 SQLite ブラックボードを通じて協調させます。Tessera は、*共有チェックアウト* のための薄く、依存ゼロの、ピア可視性レイヤーです。そしてこれらのツールはすべて本物の Claude Code を動かすので、Tessera の hooks はそれらの内側でも発火します。つまり Tessera は、それらと競合するのではなく、それらと **組み合わさります**。

## ライセンス

MIT。コントリビューション歓迎です。
