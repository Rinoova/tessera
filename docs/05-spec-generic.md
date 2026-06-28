# AgentSync — portable multi-agent coordination for Claude Code (generic spec, v11)

Consolidation of: deep-research (wco4p3qm0) + 8 adversarial rounds (w1zey4zss) + host verification (04) + harness facts. Re-GENERALIZED from rinoova to ANY project (user: "un modus operandi che verrà portato in OGNI progetto").

## 0. The one insight (why this is lean, not another orchestrator)
Conflict between agents has exactly THREE classes; each already has a right tool — build only the glue + the one missing piece:
| Class | Right tool | We |
|---|---|---|
| **Tracked files** (source, configs in git) | `git worktree` isolation + real `git merge`/rebase | ADOPT (don't rebuild git) |
| **Genuinely-shared files git CANNOT merge** (gitignored env/secrets, generated singletons, binaries) | `flock(1)` hard-lock + atomic write through one locked writer | BUILD (the only novel authoritative piece) |
| **Awareness** ("who is here, what are they touching, did a new agent just spawn") | per-scope append-only NDJSON bus + Claude hooks + `fs.watch` | BUILD (thin) |
Everything else is YAGNI. No vector clocks (single host ⇒ byte-offset is total order). No daemon. No Valkey locally (not reachable from host CLI; file bus is sole truth).

## 1. Scope & visibility (generic — the portability core)
- **scope(target)** = nearest project root by walking realpath UP through an ordered marker list (configurable): explicit `.agentsync-scope` file > `.git` (dir or worktree file→main root) > language manifest (`package.json`,`go.mod`,`pyproject.toml`,`Cargo.toml`,`pom.xml`,`build.gradle`,`composer.json`,…) > fallback: the dir itself. Stops at a configured boundary (`$AGENTSYNC_ROOT` or filesystem root).
- **Visibility = PATH-OVERLAP, not membership.** Two agents coordinate iff the realpaths they touch resolve into the same scope dir. ⇒ polyrepo: disjoint repos invisible; monorepo: disjoint subtrees invisible, shared subtree coordinates; cross-repo edit (agent in A edits B/shared): resolved by the TARGET's realpath, not cwd. This is the generalization of v10's ".git scope".
- **Per-scope medium = structural isolation** (Linda tuple-centre "local laws, global effect"): the bus lives IN the scope dir, so different scopes share no medium and are mutually invisible for free. Grounded: Denti/Omicini tuple centres.

## 2. On-disk layout (per scope, created lazily on first agent entry)
```
<scope>/.agentsync/            # 0700; auto-added to .gitignore + .dockerignore on creation
  bus.ndjson                   # append-only NDJSON; the awareness bus (0600)
  state/
    agents/<agent-id>          # presence + fold cursor (plain text; rebuildable, no fsync)
    locks/<enc(key)>.lock      # PERMANENT flock sidecar (never unlinked/gc'd)
    locks/<enc(key)>.owner     # display/alias only — NEVER a kill/liveness input
    gate.lock                  # serializes up/--after/gc per scope
  config.json (optional)       # per-scope overrides: tier1 globs, scope markers, boundary
```
- If a project already has a coordination dir (rinoova's `.coordination/`), `install` REUSES it (configurable `bus_path`) instead of making a second one.
- **gitignore/dockerignore is install's FIRST action**; `doctor` FAILS CLOSED until `git check-ignore` confirms (the bus is untrusted prose + may carry secrets-in-intents).

## 3. The bus (awareness layer)
- **Record** = one JSON line, written as `"\n"+json` (LEADING delimiter ⇒ a torn predecessor self-heals: split on `\n`, bad fragment fails `JSON.parse` and is discarded, successor survives). Append via one `writeSync` on `O_APPEND|O_CLOEXEC|O_NOFOLLOW`, line ≤16 KiB, NO fsync (durability = re-announce at SessionStart; page cache).
- **Schema** (tolerant reader): `{ts, from:"<boot_id>:<pid>:<starttime>", type:"announce|claim|release|edit|done|note|question|answer|ack", ref:"<scope-rel path|glob|KEY-NAME>", msg:"≤120c", pid, start, boot_id, rid:"<boot_id>:<agent-id>:<n>"}`. NO vector-clock, NO seq. Order = byte-offset. Dedup key = `rid`, or `fnv1a64(trimmed-bytes)` for legacy/rid-less lines (content-derived ⇒ stable across gc inode-swap). ts/pgid = DISPLAY only, never authority.
- **Reader**: track `(dev,ino,offset)`; split on `0x0A`; cap trailing partial at 64 KiB (discard+resync past cap); `JSON.parse` each, discard failures; every map keyed by bus strings = `Map`/`Object.create(null)` (prototype-pollution safe); `from` validated `/^[0-9a-f-]+:\d+:\d+$/` BEFORE any `/proc` use; non-matching = display-only. Incremental fold from cursor; on inode change (only via offline `doctor --gc`) cold-read + dedup so events don't re-fire. Cold fold reads 256 KiB tail.

## 4. Identity & liveness (kernel-authoritative)
- **agent-id = `${boot_id}:${pid}:${starttime}`** (starttime = `/proc/<pid>/stat` field 22, parsed AFTER the last `)` — comm may contain spaces/`)`). Defeats pid reuse.
- **Liveness**: foreign `boot_id` ⇒ unconditionally dead (reap). Same boot ⇒ `/proc/<pid>` exists AND starttime matches ⇒ alive (a hard veto on auto-reap; wall-clock TTL is never authority). Reboot sweep at up/doctor/SessionStart reaps foreign-boot state.
- **Kill target** = kernel-derived: `/proc/locks` FLOCK holder pid; pgrp = `/proc/<pid>/stat` field 5; re-validate starttime+boot_id. NEVER bus-self-written pid/pgid.

## 5. Tiered write coordination
- **Tier-0 (default, tracked files): worktree isolation.** `up` gives each job a `git worktree`+branch; integration = `git merge`/rebase. Same-file concurrency steered here (carries no data-loss since merge is the gate).
- **Tier-1 (genuinely-shared, non-mergeable files): flock hard-lock.** The set is CONFIGURED per project (`tier1` globs in config.json) OR auto-derived by a project profile (e.g. rinoova profile: compose `env_file:` membership). Writes are DENIED by the PreToolUse hook and rerouted through `agentsync put` (the single locked writer): `flock -w T -x <sidecar> node put.mjs <file> <key>` → `O_NOFOLLOW` open → apply → `fsync(tmp)`→`rename`→`fsync(dir)` → emit `edit` event (KEY-NAME only, never value) → exit releases lock. Sorted acquisition order ⇒ no ABBA deadlock. Self-watchdog `-w` ⇒ buggy holder self-releases. flock auto-releases on crash (verified). DENY only when holder kernel-confirmed dead; else SERIALIZE (park ~0 CPU).
- **Tier-2 (everything else in shared mode): advisory.** Overlap warning from the fold; last-writer-wins; honestly labeled "advisory / no detection". The real fix for same-file work is Tier-0.

## 6. Hooks (verified contracts — installed once globally in ~/.claude/settings.json ⇒ fires in EVERY project; cheap no-op when no .agentsync nearby)
| Hook | matcher | Action |
|---|---|---|
| **SessionStart** | (all) | resolve scope(cwd); if `.agentsync` exists or `AGENTSYNC_TOUCHES` set: announce + create `agents/<id>`; print "peers here + their claims" digest to stdout (injected as context). Always proceed. |
| **PreToolUse** | `Edit\|Write\|NotebookEdit\|mcp__.*(write\|edit\|create).*` | realpath `tool_input.file_path` → scope; **first-PreToolUse announce latch** (covers subagents, which don't fire SessionStart); incremental fold ∩ /proc for overlap. Tier-1 target ⇒ **DENY** + steer to `agentsync put`. Else warn-only (never deny) — overlap note returned via reason. |
| **PreToolUse** | `Bash` | parse redirection/argv targets (`>>`,`>`,`tee`,`sed -i`,`cp`,`mv`,`dd`); realpath each; any under a live Tier-1 path ⇒ DENY+steer; **fail-closed on unparseable redirection touching a Tier-1 dir.** |
| **Stop / SubagentStop** | (all) | one final fold; surface late peers + `git status --porcelain` mutation digest; release this agent's claims; on shared-mode baseline shrink ⇒ clobber warning. |
DENY JSON: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<steer text>"}}`. Hook = one zero-dep `.mjs`, reads stdin JSON, treats file_path/content as DATA (never `sh -c`).

## 7. Launcher CLI (`agentsync`, single zero-dep node bin; thin delta over tmux+git+bus)
- `agentsync install [--global|--scope X] [--reuse-dir PATH] [--uninstall]` — merge hook block into ~/.claude/settings.json (idempotent), drop the skill, write per-scope gitignore FIRST. Global = works everywhere.
- `agentsync up --scope X --task "…" [-n K] [--isolated|--shared] [--touches …|auto] [--dry-run] [--after id]` — DEFAULT `--isolated` (worktree+branch) per job; `--dry-run` previews predicted collisions (structural Tier-1 membership + bus hit-rate) BEFORE launch; spawns each job in `tmux new-window` with `AGENTSYNC_TOUCHES` env; assigns label `wave<N>.<svc>.<i>`; parent announces child.
- `agentsync ps [--scope X] [--follow] [--problems]` — kernel-verified live agents, Tier-1 flock holders (from /proc/locks), wait depth, wave roll-up; `--follow` uses foreground `fs.watch` (real-time, zero idle daemon). Each row prints a ready `agentsync kill <label>`.
- `agentsync kill <label|triple>` — safe teardown: resolve label→(boot_id,pid,starttime), re-validate, signal kernel-derived pgrp. D-state = wait-only (refused with note).
- `agentsync put <file> <KEY>` (value on stdin) — the single locked Tier-1 writer (agent-facing; invoked by the DENY steer).
- `agentsync doctor [--gc]` — FAIL/WARN health check (gitignore confirmed, worktree classification, lock-key==scope==bus-path, no sidecar dev/ino alias, kill-path has zero bus-sourced pid, every mutation tool DENYs a Tier-1 path, a collision scope lacking a hook ⇒ WARN "install --scope X"). `up` refuses on FAIL for touched scopes only.

## 8. Threat model (one uid; defend only what's defensible)
DEFEND: (1) data integrity (flock + atomic rename); (2) correct kill targeting (kernel pid/pgrp). NOT defended (stated, zero wasted effort): same-uid availability (flock-park / bus-flood = human-kill-only, surfaced RED); secret-value confidentiality (`/proc/*/environ` is same-uid readable); hook/audit tamper (same-uid writable; `chattr +a`+off-host sink is the Phase-2 upgrade).

## 9. Build plan (MVP ~1 day, lean)
P0: `install` (global hook merge + skill + gitignore-first) + `scope`/`canonicalize` lib + identity lib.
P1: bus reader/writer (framing+dedup+proto-safe) → SessionStart+PreToolUse+Stop hook `.mjs` → `up`(worktree+tmux+preview)/`ps`(--follow fs.watch)/`kill`(kernel pgrp) → `put`+flock writer → `doctor`.
P2 (opt): project profiles (rinoova compose-membership Tier-1 auto-derive); `watch --alarm` unattended wedge alert via notify-send; SOPS to retire flock for env files; Valkey/cross-host accelerator (zero authority).

## 10. Empirically verified (host) — see 04
flock holds-through-command + auto-release ✓ · fs.watch on O_APPEND ✓ · realpath -m ✓ · FNV-1a 1700 lines 15ms ✓ · tmux 3.6 headless ✓ · setsid/boot_id ✓ · PreToolUse DENY contract ✓ · settings merge global ✓ · subagents inherit PreToolUse, not SessionStart ✓ · no local Valkey ✓ · inotify limits 65536/128/16384 (watch only the small .agentsync dir).
