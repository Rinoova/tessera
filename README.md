# Tessera

**English** · [Italiano](README.it.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt.md) · [简体中文](README.zh-Hans.md) · [日本語](README.ja.md)

<p align="center"><img src="docs/img/hero.png" alt="Tessera — many agents, one shared folder, no collisions" width="840"></p>

Tessera lets you run **several local AI coding agents in the same folder at once** without them silently overwriting each other's work. It's tiny (zero dependencies), runs on any project, and needs no background service — coordination rides on a shared file plus [Claude Code](https://docs.claude.com/en/docs/claude-code)'s hooks.

> **A skill you install once, then forget.** Tessera plugs into Claude Code as a skill + hooks. In a project that doesn't use it, it's a ~millisecond shell check that does nothing; in one that does, it adds no work your agents have to think about — they don't even need to know it's there.

> **The name.** A *tessera* is a single tile in a mosaic. In a *tessellation*, tiles cover a surface with **no gaps and no overlaps** — exactly what you want from many agents sharing one codebase.

---

## The problem

Start two or three agents on the same repo and you hit, in this order:

1. **Silent clobbering.** Two agents edit the same file at the same moment. The second save wins; the first agent's work disappears — with no error.
2. **No awareness.** You can't see who is touching what. You find out about the collision later — at a merge conflict or a broken build.
3. **Unpredictable spawns.** Agents are launched ad hoc (by you, or by other agents). Nothing tells the agents already working that a newcomer just arrived.
4. **Existing tools dodge it.** Most multi-agent runners give each agent its own *git worktree* and let `git merge` sort things out afterward. Great for fully independent work — but no help when agents must collaborate **in one shared checkout**.

<img src="docs/img/problem.png" alt="Two agents edit the same file at once and one silently overwrites the other" width="840">

<p align="center"><sub><i>Two agents save <code>src/api.js</code> at the same moment — the second write wins, the first agent's work is gone, and nothing warns you.</i></sub></p>

---

## The idea: a shared board

Picture a team working in one room. On the wall hangs a board. Whenever someone starts a task they write it up — *"I'm on `api.js`"* — and everyone glances at the board before grabbing a file.

**Tessera is that board for your agents.** It lives *inside* the project (`<project>/.tessera/`) as a simple append-only log. Every agent announces itself and writes down what it's editing; every other agent reads it in real time. When two reach for the same file, the one about to write gets a heads-up.

<img src="docs/img/blackboard.png" alt="A shared board where each agent writes what it is editing and peers read it in real time" width="840">

<p align="center"><sub><i>Each agent posts what it's editing. When the newcomer D reaches for A's file, the board shows the clash at once — so they coordinate instead of colliding.</i></sub></p>

No agent has to *know about* Tessera or cooperate on purpose — it's wired through Claude Code's hooks (see **How it works**, below).

---

## Per-folder scope — no cross-project noise

The board lives *in* the project, so it only connects agents who actually share that project. Two agents in two different repos write to two different boards and are **mutually invisible**. A monorepo's sub-projects stay independent too.

<img src="docs/img/scopes.png" alt="Two projects, each with its own board; agents in different projects are mutually invisible" width="840">

<p align="center"><sub><i>Two projects, two boards. Agents in different folders share nothing and never see each other — no noise, no false alarms.</i></sub></p>

A *scope* is the nearest folder up the tree bearing a marker (`.git`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …, or an explicit `.tessera-scope`). Agents coordinate only where the paths they touch land in the **same** scope.

---

## How it works (under the hood)

Tessera is deliberately small. It rests on one observation: **conflicts come in three kinds, and two of them already have great tools.**

| Kind of file | The right tool | Tessera's job |
|---|---|---|
| **Tracked files** (in git) | `git worktree` isolation + real `git merge` | **adopt it** — `tessera up --isolated` gives each agent its own worktree + branch |
| **Awareness** (who's here, what they touch) | *nothing lightweight existed* | **build it** — the shared board (the default mode) |
| **Shared files git can't merge** (gitignored env, generated singletons) | a `flock` + atomic write | **planned** (opt-in flock mode), not in this release |

So Tessera builds only the thin missing piece — *awareness* — and reuses `git`, `flock`, `inotify` (via Node's `fs.watch`), `tmux`, and NDJSON for the rest. There are **no vector clocks** (on one machine a single append-only file is already a total order), **no daemon**, and **no idle cost**.

<img src="docs/img/flow.png" alt="Lifecycle: an agent announces itself on start, checks the board before editing, then coordinates" width="840">

<p align="center"><sub><i>The whole loop is automatic: announce on start, check the board before editing, coordinate on a clash — all driven by hooks, invisible to the agent.</i></sub></p>

A few specifics for the curious:

- **The board is the source of truth.** Append-only NDJSON; a torn write self-heals (each record is framed with a leading newline), and the reader is deduplicated and prototype-pollution-safe. `fs.watch` is only a *doorbell* — agents always reconcile against the log.
- **Identity = the session.** A separate `claude` run is one agent; its own sub-agents are that single unit of work (Claude already splits their files). Liveness is a heartbeat plus, when known, `/proc`.
- **The gate is a hook.** `PreToolUse` can warn — or hard-block under `TESSERA_GUARD=1` — *before* a write lands, entirely in userspace (no privileges, no `fanotify`).

📖 **Going deeper:** the full reasoning behind every choice — what we tried and rejected, and why it stays fast and lightweight — is in **[docs/RATIONALE.md](docs/RATIONALE.md)**.

---

## Install

```bash
git clone <repo-url> tessera && cd tessera
node bin/tessera.mjs install --global      # add the hooks to ~/.claude/settings.json (auto-backed-up); fires everywhere
# dormant (~ms shell pre-filter) in every project until one opts in:
node bin/tessera.mjs install --scope .      # opt THIS project in (creates .tessera/, gitignores it)
node bin/tessera.mjs install --uninstall    # remove the hooks (the skill dir and per-scope .tessera/ are left in place)
```

**Requirements:** Linux, **node ≥18**, the [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI, and `git`; `tmux` is optional (the launcher falls back to a detached spawn without it). To use `tessera` directly, run `npm link` (or `npm install -g .`) in the repo, or symlink `bin/tessera.mjs` onto your `PATH`. There are **no npm dependencies** to install.

## Use

```bash
tessera up --task "split the API module" -n 3      # 3 agents, SHARED checkout: awareness board + overlap warnings
tessera up --task "migrate to v2" -n 5 --isolated   # 5 agents, each in its own git worktree + branch
tessera up --task "..." -n 3 --dry-run              # preview the predicted collisions, don't launch
tessera ps --follow                                 # live dashboard: who's active, what they touch, overlaps
tessera ps --all                                    # every participating scope under the current folder
tessera kill wave1.2                                # safe teardown (tmux window / process group)
tessera doctor                                      # health check
```

## What you get automatically

Once installed, every agent — however it's launched — participates with no extra effort:

- **On start** → it announces itself and is told *"N other agents are active here, touching X, Y."*
- **Before each edit** (`Edit` / `Write` / `NotebookEdit`) → it records what it's touching; if a live peer is on the **same file**, it gets a coordination warning (or a hard block under `TESSERA_GUARD=1`).
- **On stop / end** → heartbeat and release.

## Guarantees & limits

Single Linux host, one user, local filesystem (advisory locks and inotify are unreliable on NFS). Tessera defends **data integrity** and **correct teardown targeting**; it does **not** defend against a malicious same-user process, nor protect secret *values* — stated plainly, not pretended. Coordinating agents across *different machines* is a planned optional layer (a network transport over a mesh VPN); today the local board is the whole story, deliberately. See [`docs/ROADMAP.md`](docs/ROADMAP.md) and [`docs/DESIGN.md`](docs/DESIGN.md).

## Related work

Isolation-first runners — **uzi**, **claude-squad**, **vibe-kanban**, **Conductor** — give each agent its own worktree/workspace and defer conflicts to `git merge`; **claude-flow** coordinates the sub-agents *it* orchestrates through a heavyweight shared SQLite blackboard. Tessera is the thin, zero-dependency, peer-awareness layer for a *shared checkout* — and since those tools all run real Claude Code, Tessera's hooks fire inside them too, so it **composes** with them rather than competing.

## License

MIT. Contributions welcome.
