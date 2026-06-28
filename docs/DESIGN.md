# Tessera — design

## Problem
Run several local AI coding agents (Claude Code sessions) on the same repository at once and two can edit the same file simultaneously, silently clobbering each other. We want unpredictably-spawned agents to discover each other in real time and avoid collisions — per-folder, with no daemon, no dependencies, and no fragile global state.

## The decomposition
Conflict has three classes; each already has a correct tool, so we build only the glue plus the one missing piece:

1. **Tracked files (in git).** `git worktree` per agent + real `git merge` is the conflict gate. We *adopt* it (`up --isolated`); we don't rebuild it.
2. **Awareness** — who's active in this folder, what are they touching, did a new agent just appear. No existing lightweight tool does this for *separate* sessions in a *shared* checkout. This is what we *build*: a per-scope append-only NDJSON bus + Claude hooks + `fs.watch`.
3. **Genuinely-shared, non-git-mergeable files** (gitignored env, generated singletons). `flock(2)` + atomic write through a single locked writer. *Planned (opt-in), not in the current release* — the default ships with classes 1–2 only.

## Key decisions (and why they survived review)
- **Per-scope medium ⇒ structural cross-project invisibility.** The bus lives inside the project (`<scope>/.tessera/`), so two agents share a medium only when their touched paths resolve into the same scope. This is the Linda tuple-space "local laws, global effect" property: agents not sharing a medium are uncoordinated, for free. `scope` resolution is distance-first (nearest ancestor with a marker), so monorepo subtrees stay independent; `.tessera-scope` is an up-tree override.
- **Byte-offset is the clock.** One host + one append-only file ⇒ a total order already exists. Vector/Lamport clocks add nothing here and can't be safely garbage-collected, so there are none.
- **The file is the source of truth; any notifier is advisory.** `fs.watch`/inotify can coalesce or drop events, so the bus is authoritative and readers reconcile against it. A torn write self-heals because every record is framed with a *leading* `\n` (a broken fragment fails `JSON.parse` and is discarded; the next writer's record survives). Appends are atomic (`O_APPEND`, records well under `PIPE_BUF`).
- **Hooks are the gate.** Claude Code `PreToolUse` can deny/redirect a tool call, which replaces the root-only `fanotify` access-gating an OS-level design would need — entirely in userspace, no privileges.
- **Identity matches the runtime.** Hooks run as separate short-lived processes, so a kernel pid/starttime triple would identify the *hook*, not the agent. Awareness mode therefore keys on the harness **session id** (stable across a session's hooks); liveness is heartbeat plus, when known, `/proc`. The planned opt-in `flock` mode would use kernel `/proc/locks` holders for correct teardown targeting.
- **Lean by default.** A fresh project gets worktree isolation + the awareness bus only. The `flock` writer, shell-redirection gating, and a full health matrix are opt-in.
- **Unit of coordination = the session.** A single session's parallel sub-agents share its identity (the harness already assigns them distinct files/work); Tessera coordinates *separate* sessions, which is the real "many agents on a folder" case.

## Threat model
One uid, single Linux host, local filesystem (advisory locks and inotify are unreliable on network filesystems). Tessera defends data integrity and correct teardown targeting. It does **not** defend against a malicious same-uid process or protect secret *values* — stated, not pretended.

## How it was built
Deep web research on the primitives and prior art → multiple rounds of adversarial design review (the design kept changing materially, which is why several first-cut ideas — vector clocks, a standalone daemon, a heavyweight store — were cut) → empirical verification of every load-bearing primitive on a real host (flock holding through a wrapped command and auto-releasing on death, `fs.watch` firing on `O_APPEND` extension, the `PreToolUse` deny contract, settings-merge semantics, sub-agents inheriting `PreToolUse` but not `SessionStart`) → a final review pass before publication. The result is intentionally small.

## Related work
- **claude-flow / ruflo** (MIT) — the closest prior art and the heavyweight counterpart: it coordinates the sub-agents it *orchestrates* through a shared SQLite blackboard (`.swarm/memory.db`) plus an MCP server, hooks, and consensus. Tessera targets the opposite end: thin, zero-dependency, peer awareness for *independently launched* sessions in a shared checkout.
- **uzi**, **claude-squad**, **vibe-kanban**, **Conductor** — isolation-first orchestrators: one `git worktree` (or workspace) + terminal per agent, conflicts deferred to `git merge`/review. They sidestep the shared-checkout collision Tessera addresses. Because they all run *real* Claude Code, Tessera's hooks fire inside them too — so Tessera composes with them rather than competing.

## Why this fits a "reuse, don't reinvent" philosophy
At the primitive level Tessera invents nothing: it composes `git`, `flock`, inotify (via Node's `fs.watch`), `tmux`, and NDJSON, and applies a 30-year-old coordination model (tuple spaces / blackboards). The only original contribution is the small awareness layer that none of the existing tools provide — which is exactly what makes it worth publishing.
