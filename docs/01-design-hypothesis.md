# 01 — Initial design hypothesis: "AgentSync" (pre-research, to be attacked)

## One-line
A **daemonless-first, per-scope** coordination layer: append-only NDJSON event log + flock hard-locks + inotify real-time wakeups + vector clocks for concurrency detection, wired into Claude via **hooks**, with a tiny human-gate launcher CLI.

## Scope = the unit of visibility
- `scope` = nearest project root (walk up to `.git`; for cross-repo work like `deploy/`, the polyrepo root). Canonicalized + hashed.
- Each scope owns `<scope>/.agentsync/` (gitignored). **Different scopes share NOTHING** → cross-project invisibility is structural, not enforced.

## Five layers (daemonless base)
1. **Presence/leases** — `.agentsync/agents/<agent-id>.json` = `{agent_id,pid,started,intent,heartbeat_ts,claims[]}`. Liveness = pid alive AND heartbeat < TTL. Any agent reaps stale leases.
2. **Append-only event bus** — `.agentsync/events.ndjson`, `O_APPEND` writes. Lines kept < PIPE_BUF (4096B) ⇒ atomic concurrent appends without a lock. Events: `announce|claim|release|edit|heartbeat|question|answer|ack|done`.
3. **Vector clocks** — every event carries `{agent_id: counter}`. Compare to classify causally-ordered vs **concurrent** (⇒ potential conflict). This is the "vettoriale" core.
4. **Real-time wakeup** — **inotify** IN_MODIFY/IN_CREATE on `.agentsync/` ⇒ kernel push, zero idle cost, no polling. On wake, read log from last-seen byte offset. Log remains source of truth (handles missed/coalesced events).
5. **Hard locks where needed** — `flock(2)` advisory lock files for the few truly-serializable paths (e.g. `deploy/compose.yaml`, `.env-*`, `docs/index.json`). flock **auto-releases on process death** ⇒ no stale locks. Soft claims (announced globs) for everything else; LLM negotiates.

## Hooks = the integration surface (currently unused here)
- `SessionStart` → register lease, announce, print "who else is in this scope + active claims" digest.
- `PreToolUse(Edit|Write)` → if a LIVE peer claims an overlapping path: warn/deny via hook decision + suggest coordination; else record intent.
- `PostToolUse(Edit|Write)` → append `edit` event (path + bumped vclock) so peers see it instantly.
- `Stop|SubagentStop|SessionEnd` → release leases/claims, emit `done`.

## Human-gate launcher (one zero-dep CLI)
- `agentsync ps` — live agents per scope (from leases).
- `agentsync watch` — TUI dashboard: scopes × agents × claims × recent events × **conflict warnings**.
- `agentsync up --scope X --task "..." [-n K]` — spawn K Claude agents with hooks wired; show collisions before they happen.
- `agentsync say/claim/release` — manual ops.

## Why fast + cheap
Daemonless ⇒ zero idle CPU/RAM (inotify is kernel). Atomic <4KB appends ⇒ no lock on the hot path. flock ⇒ crash-safe auto-release. Per-scope dirs ⇒ no central bottleneck, natural sharding. Vector clocks ⇒ tiny int maps.

## Runner-ups (to compare adversarially)
- A: Pure Valkey pub/sub + SETNX leases — host↔container reachability problem; idle cost; dependency. Keep as OPTIONAL tier-2.
- B: Tuple space (Linda) over SQLite WAL — elegant matching + per-scope visibility, but single-writer WAL + busy timeouts; heavier.
- C: Per-scope Unix-domain-socket micro-daemon — lower latency + active fan-out + central reaper, but idle process + restart/crash recovery.
- D: fanotify — needs CAP_SYS_ADMIN/root → rejected; inotify is unprivileged.
- E: CRDT presence — overkill on one host.

## Failure modes to guard
stale lock (→flock auto-release + TTL reap + pid check) · lost/coalesced inotify (→log is truth, read-from-offset + IN_Q_OVERFLOW safety rescan) · thundering herd (→append-only, jitter) · split-brain on soft claim (→flock arbiter for hard paths; vclock+event-visibility+negotiation for soft) · append interleave >PIPE_BUF (→cap line size or framed write under brief flock) · log rotation vs inotify (→watch dir, handle IN_CREATE).

## Open questions for research to settle
- Do existing tools (claude-squad, container-use, uzi, vibe-kanban, Conductor, Crystal) already solve this with **git worktrees** — making intra-scope coordination unnecessary? (Worktree-per-agent = isolation by construction; but then "coordinate on shared folder" requirement implies they DON'T want full isolation, they want shared-checkout collaboration.)
- inotify reliability under heavy fs churn; need for `fanotify`/`io_uring` instead.
- Is a daemon actually unavoidable for sub-ms fan-out + reliable reaping?
- Best compact wire format ("vectorial/fast"): NDJSON vs length-prefixed CBOR/MessagePack vs a mmap ring buffer.
