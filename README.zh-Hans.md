# Tessera

[English](README.md) · [Italiano](README.it.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt.md) · **简体中文** · [日本語](README.ja.md)

**面向在相同文件夹中协作的多个本地 AI 编码代理的底层、零依赖协调方案。**

当你在同一个仓库上同时运行多个 [Claude Code](https://docs.claude.com/en/docs/claude-code) 代理时，其中两个可能会在同一时刻编辑同一个文件，并悄无声息地覆盖彼此的成果。Tessera 让以不可预测方式启动的代理能够**实时发现彼此**，并**不再互相干扰**——按文件夹划分、无守护进程、崩溃安全，适用于任何项目（polyrepo、monorepo、单一仓库、任意语言）。

> **为什么叫 "Tessera"？** 一块 *tessera* 是马赛克镶嵌画中的一片单独的瓷砖。在 *tessellation*（密铺）中，瓷砖铺满整个表面，**没有缝隙，也没有重叠**——这正是这里的目标：众多代理像瓷砖一样铺满工作，却从不重叠。每个代理是一块 tessera；共享总线则是整幅马赛克。

## 一句话讲清思路

代理之间的冲突分为三类，每一类其实都已有对应的合适工具——因此 Tessera 只构建那层薄薄的粘合层，外加唯一一块真正缺失的部件：

| 类别 | 合适的工具 | Tessera |
|---|---|---|
| **被跟踪的文件**（纳入 git） | `git worktree` 隔离 + 真正的 `git merge` | **采用**它（`up --isolated`） |
| **感知**——谁在这里、他们在改什么、是否有人刚刚启动 | 按 scope 划分的仅追加 **NDJSON 总线** + Claude **hooks** + `fs.watch` | **构建**（薄层）——默认方案 |
| **git 无法合并的真正共享文件**（被 gitignore 的环境文件、生成的单例文件） | `flock(2)` 锁 + 原子写入 | **计划中**（可选启用的 flock 模式——本次发布尚未包含） |

无需向量时钟（在单台主机上，单个仅追加文件的**字节偏移量本身就是一个全序**）。无守护进程。无空闲开销。在原语层面没有发明任何新东西——它组合了 `git`、`flock`、`inotify`（通过 `fs.watch`）、`tmux` 以及 NDJSON。

## 为什么按文件夹划分 scope 是自动的

协调媒介（`<scope>/.tessera/`）就存在于项目*内部*，因此两个代理**只有在**它们所触及的路径解析到同一个 scope 时才会共享同一媒介。位于不同项目中的代理彼此无任何共享，且相互不可见——而且这是免费实现的。（这正是 Linda 元组空间的“局部法则，全局效果”特性。）`scope` = 携带标记（`.tessera-scope`、`.git`、`package.json`、`go.mod`、`pyproject.toml`、`Cargo.toml`……）的最近祖先目录，按距离优先，因此 monorepo 的各个子树保持彼此独立。

## 安装

```bash
git clone <repo-url> tessera && cd tessera
node bin/tessera.mjs install --global      # merge hooks into ~/.claude/settings.json (auto-backed-up); fires everywhere
# dormant (~ms sh pre-filter) in every project until one opts in:
node bin/tessera.mjs install --scope .      # opt THIS project in (creates .tessera/, gitignores it)
node bin/tessera.mjs install --uninstall    # remove the hooks (the skill dir and per-scope .tessera/ are left in place)
```
**环境要求：** Linux、**node ≥18**、[Claude Code](https://docs.claude.com/en/docs/claude-code) CLI 以及 `git`；`tmux` 为可选项（没有它时，启动器会退而采用脱离终端的进程派生方式）。若要直接运行 `tessera`，请在仓库中执行 `npm link`（或 `npm install -g .`）——`bin` 字段已经设置好了——或者将 `bin/tessera.mjs` 软链接到你的 `PATH` 上。没有任何需要安装的 npm 依赖。

## 使用——启动并观察多个代理

```bash
tessera up --task "split the API module" -n 3      # 3 agents, SHARED checkout, awareness + overlap warnings
tessera up --task "migrate to v2" -n 5 --isolated   # 5 agents, each in its own git worktree+branch
tessera up --task "..." -n 3 --dry-run              # preview predicted collisions, don't launch
tessera ps --follow                                 # real-time dashboard: who's live, what they touch, overlaps
tessera ps --all                                    # every participating scope under cwd
tessera kill wave1.2                                # safe teardown (tmux window / process group)
tessera doctor                                      # health check
```

## 你能自动获得什么（通过 Claude hooks——无需代理之间相互配合）

- **SessionStart** → 每个代理都会宣告自身存在，并被告知*“这里还有 N 个活跃代理，正在触及 X、Y。”*
- **PreToolUse(Edit/Write/NotebookEdit)** → 记录每个代理所编辑的内容；如果某个存活的同伴正在触及**同一个文件**，正在编辑的代理会收到一条协调警告（在 `TESSERA_GUARD=1` 下则是硬性阻断）。
- **Stop / SessionEnd** → 心跳 / 释放。

协调的基本单位是**代理会话**（一次独立的 `claude` 调用）。总线为仅追加，崩溃安全（前导 `\n` 分帧机制能自我修复被撕裂的写入）、防原型污染，并经过去重处理。身份由 session id 标识；存活状态由心跳判定，并在已知时辅以 `/proc`。

## 保证的适用范围

单台 Linux 主机、单个 uid、本地文件系统（建议性锁和 inotify 在 NFS 上不可靠）。Tessera 守护的是**数据完整性**与**正确的拆除目标定位**；它**并不**防御恶意的同 uid 进程，也**不**保护机密的*取值*——这一点直言不讳，绝不假装。跨*不同机器*协调代理是一个计划中的可选层（一种基于网状 VPN 的网络传输）；而今天，本地文件总线就是全部内容——这是有意为之。

## 目录结构

```
lib/      scope · identity · bus · proc · coord · config · args
hooks/    tessera-hook.sh (fast pre-filter) → tessera-hook.mjs (handler)
cmd/      install · up · ps · kill · doctor
bin/      tessera.mjs
test/     selftest.mjs · dummy-agent.mjs
docs/     DESIGN.md
```

## 许可证

MIT。欢迎贡献。
