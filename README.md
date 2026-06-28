# AgentSync

Portable, low-level coordination for **multiple local Claude Code agents** working on shared folders — so unpredictably-spawned agents discover each other in real time and don't step on each other's feet. Per-scope, daemonless, zero runtime deps, crash-safe. Works in any project (polyrepo, monorepo, single repo, any language).

> Built from deep web research + 8 rounds of adversarial design review + empirical kernel verification. See `docs/DESIGN.md` for the full lineage and rationale.

## The idea in one line

Conflict between agents has exactly three classes, and each already has the right tool — so AgentSync builds only the thin glue plus the one genuinely-missing piece:

| Class | Tool | AgentSync |
|---|---|---|
| **Tracked files** (in git) | `git worktree` isolation + real `git merge` | **adopts** it (`up --isolated`) |
| **Awareness** — who's here, what are they touching, did someone just spawn | per-scope append-only **NDJSON bus** + Claude **hooks** + `fs.watch` | **builds** (thin) — the default |
| **Genuinely-shared files git can't merge** (gitignored env/secrets, generated singletons) | `flock(2)` hard-lock + atomic write | **builds** (opt-in "flock mode") |

No vector clocks: on one host a single append-only file's **byte offset is already a total order**. No daemon. No idle cost.

## Why per-folder scoping is automatic

The coordination medium (`<scope>/.agentsync/`) physically lives *inside* the project. Two agents share a medium **iff** the paths they touch resolve into the same scope — so two agents in two different projects share nothing and are mutually invisible, for free. (This is the Linda tuple-centre "local laws, global effect" property — see DESIGN.md.) `scope` = the nearest ancestor bearing a marker (`.agentsync-scope`, `.git`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …), distance-first, so monorepo subtrees stay independent.

## Install

```bash
node bin/agentsync.mjs install --global     # merge hooks into ~/.claude/settings.json (backed up); fires everywhere
# dormant (~2ms sh pre-filter) in every project until one opts in:
node bin/agentsync.mjs install --scope .     # opt THIS project in (creates .agentsync/, gitignores it)
# or always-on everywhere:  add  "env": { "AGENTSYNC_AUTO": "1" }  (install --global --auto)
node bin/agentsync.mjs install --uninstall   # clean removal
```

## Use — launch & watch many jobs (the human gate)

```bash
agentsync up --task "split the API module" -n 3        # 3 agents, SHARED checkout, awareness + overlap warnings
agentsync up --task "migrate to v2" -n 5 --isolated     # 5 agents, each in its own git worktree+branch
agentsync up --task "..." -n 3 --dry-run                # preview predicted collisions, don't launch
agentsync ps --follow                                   # real-time dashboard: who's live, what they touch, overlaps
agentsync ps --all                                      # every participating scope under cwd
agentsync kill wave1.2                                  # safe teardown (tmux window / process group)
agentsync doctor                                        # health check
```

## What you get automatically (via hooks, no agent cooperation required)

- **SessionStart** → each agent announces itself and is told *"N other agents are active here, touching X, Y"*.
- **PreToolUse(Edit/Write/NotebookEdit)** → records what each agent is editing; if a live peer is touching the **same file**, the editing agent gets a coordination warning (or a hard DENY under `AGENTSYNC_GUARD=1`).
- **Stop/SessionEnd** → heartbeat / release.

Identity is the harness `session_id`; liveness is heartbeat + (when known) `/proc` pid. The bus is append-only, crash-safe (leading-`\n` framing self-heals torn writes), prototype-pollution-safe, and deduped.

## Threat model (one uid)

Defends **data integrity** and **correct kill targeting**. Does **not** defend against a same-uid malicious agent (bus flooding, etc.) or secret-value confidentiality — those are human-kill-only and stated plainly, not papered over. Linux + local filesystem only (advisory locks & inotify are unreliable on NFS).

## Files

```
lib/      scope.mjs identity.mjs bus.mjs proc.mjs coord.mjs config.mjs args.mjs
hooks/    agentsync-hook.sh (fast pre-filter) → agentsync-hook.mjs (handler)
cmd/      install up ps kill doctor
bin/      agentsync.mjs
test/     selftest.mjs  dummy-agent.mjs
docs/     DESIGN.md
```

Zero npm dependencies. Requires: node ≥18, and for the launcher: `git`, `tmux` (optional — falls back to detached spawn).
