# Tessera

**Low-level, zero-dependency coordination for multiple local AI coding agents working in the same folders.**

When you run several [Claude Code](https://docs.claude.com/en/docs/claude-code) agents at once on the same repo, two of them can edit the same file at the same time and silently clobber each other's work. Tessera lets unpredictably-spawned agents **discover each other in real time** and **stop stepping on each other's feet** — per-folder, daemonless, crash-safe, on any project (polyrepo, monorepo, single repo, any language).

> **Why "Tessera"?** A *tessera* is a single tile in a mosaic. In a *tessellation*, tiles cover the surface with **no gaps and no overlaps** — exactly the goal here: many agents tiling the work, never overlapping. Each agent is a tessera; the shared bus is the mosaic.

## The idea in one line

Conflict between agents has three classes, and each already has the right tool — so Tessera builds only the thin glue plus the one genuinely-missing piece:

| Class | Right tool | Tessera |
|---|---|---|
| **Tracked files** (in git) | `git worktree` isolation + real `git merge` | **adopts** it (`up --isolated`) |
| **Awareness** — who's here, what are they touching, did someone just spawn | a per-scope append-only **NDJSON bus** + Claude **hooks** + `fs.watch` | **builds** (thin) — the default |
| **Genuinely-shared files git can't merge** (gitignored env, generated singletons) | `flock(2)` lock + atomic write | **planned** (opt-in flock mode — not in this release) |

No vector clocks (on one host a single append-only file's **byte offset is already a total order**). No daemon. No idle cost. Nothing invented at the primitive level — it composes `git`, `flock`, `inotify` (via `fs.watch`), `tmux`, and NDJSON.

## Why per-folder scoping is automatic

The coordination medium (`<scope>/.tessera/`) lives *inside* the project, so two agents share a medium **only if** the paths they touch resolve into the same scope. Agents in different projects share nothing and are mutually invisible — for free. (This is the Linda tuple-space "local laws, global effect" property.) `scope` = the nearest ancestor bearing a marker (`.tessera-scope`, `.git`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …), distance-first, so monorepo subtrees stay independent.

## Install

```bash
git clone <repo-url> tessera && cd tessera
node bin/tessera.mjs install --global      # merge hooks into ~/.claude/settings.json (auto-backed-up); fires everywhere
# dormant (~ms sh pre-filter) in every project until one opts in:
node bin/tessera.mjs install --scope .      # opt THIS project in (creates .tessera/, gitignores it)
node bin/tessera.mjs install --uninstall    # remove the hooks (the skill dir and per-scope .tessera/ are left in place)
```
**Requirements:** Linux, **node ≥18**, the [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI, and `git`; `tmux` is optional (the launcher falls back to a detached spawn without it). To use `tessera` directly, run `npm link` (or `npm install -g .`) in the repo — the `bin` field is already set — or symlink `bin/tessera.mjs` onto your `PATH`. There are no npm dependencies to install.

## Use — launch & watch many agents

```bash
tessera up --task "split the API module" -n 3      # 3 agents, SHARED checkout, awareness + overlap warnings
tessera up --task "migrate to v2" -n 5 --isolated   # 5 agents, each in its own git worktree+branch
tessera up --task "..." -n 3 --dry-run              # preview predicted collisions, don't launch
tessera ps --follow                                 # real-time dashboard: who's live, what they touch, overlaps
tessera ps --all                                    # every participating scope under cwd
tessera kill wave1.2                                # safe teardown (tmux window / process group)
tessera doctor                                      # health check
```

## What you get automatically (via Claude hooks — no agent cooperation needed)

- **SessionStart** → each agent announces itself and is told *"N other agents are active here, touching X, Y."*
- **PreToolUse(Edit/Write/NotebookEdit)** → records what each agent edits; if a live peer is touching the **same file**, the editing agent gets a coordination warning (or a hard block under `TESSERA_GUARD=1`).
- **Stop / SessionEnd** → heartbeat / release.

The unit of coordination is the **agent session** (a separate `claude` invocation). The bus is append-only, crash-safe (leading-`\n` framing self-heals torn writes), prototype-pollution-safe, and deduplicated. Identity is the session id; liveness is heartbeat + (when known) `/proc`.

## Scope of guarantees

Single Linux host, one uid, local filesystem (advisory locks & inotify are unreliable on NFS). Tessera defends **data integrity** and **correct teardown targeting**; it does **not** defend against a malicious same-uid process or protect secret *values* — stated plainly, not pretended. Coordinating agents across *different machines* is a planned optional layer (a network transport over a mesh VPN); today the local file bus is the whole story, deliberately.

## Layout

```
lib/      scope · identity · bus · proc · coord · config · args
hooks/    tessera-hook.sh (fast pre-filter) → tessera-hook.mjs (handler)
cmd/      install · up · ps · kill · doctor
bin/      tessera.mjs
test/     selftest.mjs · dummy-agent.mjs
docs/     DESIGN.md
```

## License

MIT. Contributions welcome.
