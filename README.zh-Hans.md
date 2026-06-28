# Tessera

[English](README.md) · [Italiano](README.it.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt.md) · **简体中文** · [日本語](README.ja.md)

<p align="center"><img src="docs/img/hero.png" alt="Tessera —— 多个 agent，同一个共享文件夹，互不冲突" width="840"></p>

Tessera 让你**在同一个文件夹中同时运行多个本地 AI 编码 agent**，而不会让它们悄无声息地覆盖彼此的工作。它非常小巧（零依赖），可在任何项目上运行，也不需要任何后台服务——协调机制依靠一个共享文件加上 [Claude Code](https://docs.claude.com/en/docs/claude-code) 的 hooks。

> **一次安装，从此无需操心的 skill。** Tessera 以 skill + hooks 的形式接入 Claude Code。在不使用它的项目中，它只是一个耗时约毫秒、什么都不做的 shell 检查；在使用它的项目中，它不会给你的 agent 增加任何需要思考的负担——它们甚至不需要知道它的存在。

> **关于这个名字。** 一块 *tessera* 是马赛克中的一块小拼片。在 *tessellation*（密铺）中，这些拼片覆盖一个表面，**没有缝隙也没有重叠**——这正是你希望多个 agent 共享同一套代码库时所达到的效果。

---

## 问题所在

在同一个仓库上启动两三个 agent，你会按以下顺序遇到这些问题：

1. **悄无声息的覆盖。** 两个 agent 在同一时刻编辑同一个文件。后保存的那个胜出；第一个 agent 的工作消失了——而且没有任何报错。
2. **缺乏感知。** 你看不到谁在动什么。你只能在之后才发现冲突——在一次合并冲突或一次构建失败时。
3. **无法预测的启动。** agent 是临时启动的（由你，或由其他 agent 启动）。没有任何机制告诉已经在工作的 agent 有新成员刚刚加入。
4. **现有工具回避了这个问题。** 大多数多 agent 运行器给每个 agent 各自的 *git worktree*，然后让 `git merge` 事后来收拾。这对于完全独立的工作很棒——但当 agent 必须**在同一份共享检出中**协作时，它毫无帮助。

<img src="docs/img/problem.png" alt="两个 agent 同时编辑同一个文件，其中一个悄无声息地覆盖了另一个" width="840">

<p align="center"><sub><i>两个 agent 在同一时刻保存 <code>src/api.js</code>——后写入的胜出，第一个 agent 的工作丢失了，而且没有任何东西警告你。</i></sub></p>

---

## 思路：一块共享看板

设想一个团队在同一个房间里工作。墙上挂着一块看板。每当有人开始一项任务，就把它写上去——*“我在处理 `api.js`”*——而且每个人在动手抢一个文件之前都会瞥一眼看板。

**Tessera 就是给你的 agent 准备的那块看板。** 它存在于项目*内部*（`<project>/.tessera/`），是一个简单的仅追加日志。每个 agent 都会宣告自己，并记下它正在编辑什么；其他每个 agent 都会实时读取它。当两个 agent 伸手去拿同一个文件时，即将写入的那个会得到提醒。

<img src="docs/img/blackboard.png" alt="一块共享看板，每个 agent 在上面写下自己正在编辑什么，同伴实时读取" width="840">

<p align="center"><sub><i>每个 agent 都贴出自己正在编辑的内容。当新来的 D 伸手去拿 A 的文件时，看板立刻显示出冲突——于是它们协调而非碰撞。</i></sub></p>

没有任何 agent 需要*知道* Tessera 的存在或刻意配合——它是通过 Claude Code 的 hooks 接入的（见下文的**工作原理**）。

---

## 按文件夹划分作用域——没有跨项目的噪音

看板存在于项目*内部*，所以它只连接真正共享该项目的 agent。两个位于两个不同仓库中的 agent 写入两块不同的看板，彼此**互不可见**。monorepo 的各个子项目也保持独立。

<img src="docs/img/scopes.png" alt="两个项目，各有自己的看板；不同项目中的 agent 彼此互不可见" width="840">

<p align="center"><sub><i>两个项目，两块看板。不同文件夹中的 agent 不共享任何东西，也永远看不到彼此——没有噪音，没有误报。</i></sub></p>

一个*作用域（scope）*是沿目录树向上、最近一个带有标记的文件夹（`.git`、`package.json`、`go.mod`、`pyproject.toml`、`Cargo.toml`、……，或一个显式的 `.tessera-scope`）。只有当 agent 所触及的路径落在**同一个**作用域中时，它们才会协调。

---

## 工作原理（幕后机制）

Tessera 刻意保持小巧。它建立在一个观察之上：**冲突分为三类，其中两类已经有了出色的工具。**

| 文件类型 | 合适的工具 | Tessera 的职责 |
|---|---|---|
| **被跟踪的文件**（在 git 中） | `git worktree` 隔离 + 真正的 `git merge` | **采用它**——`tessera up --isolated` 给每个 agent 各自的 worktree + 分支 |
| **感知**（谁在这里，他们触及什么） | *没有任何轻量级方案存在* | **构建它**——共享看板（默认模式） |
| **git 无法合并的共享文件**（被 gitignore 的环境文件、生成的单例文件） | 一个 `flock` + 原子写入 | **已规划**（可选启用的 flock 模式），不在本次发布中 |

所以 Tessera 只构建那块缺失的薄薄一层——*感知*——其余部分则复用 `git`、`flock`、`inotify`（通过 Node 的 `fs.watch`）、`tmux` 和 NDJSON。这里**没有向量时钟**（在单台机器上，一个仅追加文件本身就已经是一个全序），**没有守护进程**，也**没有空闲开销**。

<img src="docs/img/flow.png" alt="生命周期：agent 在启动时宣告自己，在编辑前检查看板，然后进行协调" width="840">

<p align="center"><sub><i>整个循环是自动的：启动时宣告，编辑前检查看板，发生冲突时协调——全部由 hooks 驱动，对 agent 而言不可见。</i></sub></p>

给好奇者的一些细节：

- **看板是事实的唯一来源。** 仅追加的 NDJSON；一次被撕裂的写入会自我修复（每条记录都以一个前导换行符作为帧界），读取端则去重且对原型污染安全。`fs.watch` 只是一个*门铃*——agent 总是以日志为准进行核对。
- **身份 = 会话。** 一次独立的 `claude` 运行就是一个 agent；它自己的子 agent 就是那同一个工作单元（Claude 已经会拆分它们的文件）。存活性由心跳判定，在可知时再加上 `/proc`。
- **闸门是一个 hook。** `PreToolUse` 可以发出警告——或在 `TESSERA_GUARD=1` 下硬性拦截——*在*一次写入落地*之前*，完全在用户空间中完成（无需权限，无需 `fanotify`）。

📖 **想深入了解：** 每一个选择背后的完整推理——我们尝试过什么、又否决了什么，以及为什么它保持快速而轻量——都在 **[docs/RATIONALE.md](docs/RATIONALE.md)** 中。

---

## 安装

```bash
git clone <repo-url> tessera && cd tessera
node bin/tessera.mjs install --global      # add the hooks to ~/.claude/settings.json (auto-backed-up); fires everywhere
# dormant (~ms shell pre-filter) in every project until one opts in:
node bin/tessera.mjs install --scope .      # opt THIS project in (creates .tessera/, gitignores it)
node bin/tessera.mjs install --uninstall    # remove the hooks (the skill dir and per-scope .tessera/ are left in place)
```

**环境要求：** Linux、**node ≥18**、[Claude Code](https://docs.claude.com/en/docs/claude-code) CLI 以及 `git`；`tmux` 为可选项（没有它时，启动器会回退为一次脱离终端的 spawn）。要直接使用 `tessera`，可在仓库中运行 `npm link`（或 `npm install -g .`），或将 `bin/tessera.mjs` 软链接到你的 `PATH` 上。**没有需要安装的 npm 依赖。**

## 使用

```bash
tessera up --task "split the API module" -n 3      # 3 agents, SHARED checkout: awareness board + overlap warnings
tessera up --task "migrate to v2" -n 5 --isolated   # 5 agents, each in its own git worktree + branch
tessera up --task "..." -n 3 --dry-run              # preview the predicted collisions, don't launch
tessera ps --follow                                 # live dashboard: who's active, what they touch, overlaps
tessera ps --all                                    # every participating scope under the current folder
tessera kill wave1.2                                # safe teardown (tmux window / process group)
tessera doctor                                      # health check
```

## 你自动获得的能力

一旦安装，每个 agent——无论它是如何启动的——都会毫不费力地参与进来：

- **在启动时** → 它宣告自己，并被告知*“这里另有 N 个 agent 处于活动状态，正在触及 X、Y。”*
- **在每次编辑之前**（`Edit` / `Write` / `NotebookEdit`）→ 它记录下自己正在触及什么；如果有一个活跃的同伴正处于**同一个文件**上，它会得到一条协调警告（或在 `TESSERA_GUARD=1` 下硬性拦截）。
- **在停止 / 结束时** → 心跳与释放。

## 保证与局限

单台 Linux 主机、单个用户、本地文件系统（建议性锁和 inotify 在 NFS 上不可靠）。Tessera 捍卫**数据完整性**和**正确的拆除目标定位**；它**不**防御恶意的同用户进程，也**不**保护机密*值*——这是如实说明，绝不假装。跨*不同机器*协调 agent 是一个已规划的可选层（一个基于 mesh VPN 的网络传输层）；如今本地看板就是全部内容，这是刻意为之。参见 [`docs/ROADMAP.md`](docs/ROADMAP.md) 和 [`docs/DESIGN.md`](docs/DESIGN.md)。

## 相关工作

以隔离为先的运行器——**uzi**、**claude-squad**、**vibe-kanban**、**Conductor**——给每个 agent 各自的 worktree/工作区，并把冲突推迟给 `git merge`；**claude-flow** 则通过一个重量级的共享 SQLite 黑板来协调*它*所编排的子 agent。Tessera 是面向*共享检出*的那一薄层、零依赖的同伴感知层——而且由于那些工具全都运行真正的 Claude Code，Tessera 的 hooks 在它们内部也会触发，所以它与它们**组合协作**，而非竞争。

## 许可证

MIT。欢迎贡献。
