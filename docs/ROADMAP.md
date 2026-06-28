# Roadmap

## Phase 1 — local, single host (shipped, this repo)
Per-scope coordination for concurrent Claude Code agents on one machine: append-only NDJSON awareness bus + Claude hooks + `git worktree` isolation. Zero dependencies. This is the whole of the published tool today, on **Linux**. (An opt-in `flock` mode for genuinely-shared, non-git-mergeable files is designed but **not yet implemented**.)

## Phase 2 — native macOS and Windows 11 (no WSL)
Run Tessera **natively** on macOS and Windows 11, with an OS-aware installer, so the same skill works wherever Claude Code runs. The awareness core (bus, hooks, scope, reader) is already OS-neutral; the port collapses into one small `lib/os.mjs` abstraction rather than a fork. Staged by effort:

- **macOS — next, low effort.** Claude Code runs hooks via `sh -c` exactly like Linux, and `tmux`/`git`/POSIX signals are all present, so macOS ships the **whole** tool (awareness **and** the launcher). The delta is small: case-insensitive path folding (APFS), an OS-local cache dir, a `/sbin/mount`-based network-fs check, and watching the bus's *parent* directory for the doorbell.
- **Windows 11 — TBD (the larger work).** No `sh`, no `/proc`, no signals/process-groups. Hooks run `node` directly (forward-slash / exec-form, so no Git Bash needed); the append bus stays correct because Node/libuv's `'a'` flag is a kernel-atomic `FILE_APPEND_DATA` write (no lock needed), with an AV/indexer open-retry. Windows ships **awareness-first** (the `up`/`kill` launcher is deferred, since `wt.exe` can't close windows and there are no signals). It is gated behind **empirical tests on real Windows hardware** (NTFS concurrent-append torture test + live hook-executor check) — which is why it's staged after macOS.

Full design, the shared-vs-branched matrix, and the ship-gate tests are in **[`docs/PORTING.md`](PORTING.md)**.

## Phase 3 — multi-host over a mesh (planned, optional layer)
Coordinate agents running on **different machines**, keeping the per-scope model unchanged and the local NDJSON file as the **offline source of truth**. Only the *transport* is added; the file bus still works with the network down.

- **Connectivity:** [Nebula](https://github.com/slackhq/nebula) (MIT) — a lightweight, easy-to-install mesh overlay VPN. Hosts reach each other on stable mesh IPs.
- **Transport (durable, replayable stream):**
  - **Primary: Valkey Streams** (BSD-3-Clause). Recommended when Valkey is already in the stack — no new component, genuine durable replay (`XADD` log + consumer groups + PEL, persisted to AOF/RDB), low idle cost. One stream key per scope (`tessera:{scope}`) maps 1:1 onto the per-scope model.
  - **Alternative: NATS + JetStream** (Apache-2.0, single &lt;20 MB Go binary). Prefer when you want a *transport-native* mesh (leaf-node JetStream with `mirror`/`source` for autonomous, offline-capable per-host brokers) or when Valkey isn't already present.
  - **Rejected: MQTT/Mosquitto** — persistent sessions and retained messages are not a replayable, scan-from-offset log, so it can't back a source-of-truth bus.
- **Integration sketch (file stays authority):** on each local append, also `XADD tessera:{scope}` carrying the file byte-offset as the shared ordering; remote agents `XREADGROUP ... BLOCK` for real-time cross-host fan-out and `XACK` on apply; a consumed entry is an idempotent *append-if-absent* into the local file. Trim the stream aggressively (`MAXLEN`) since the file is the lossless log. Valkey is a central accelerator/replicator over the mesh, not an HA dependency.

## Phase 4 — central station + mobile/web (out of scope for this repo)
A central coordination station with a mobile/web control surface is a separate, hosted product concern, not part of this thin OSS tool.

## Related work
- **claude-flow / ruflo** (MIT) — the closest prior art: a heavyweight orchestrator that coordinates the sub-agents *it* spawns via a shared SQLite blackboard (`.swarm/memory.db`) + MCP + consensus. Different weight class and use case. Tessera is the thin, zero-dependency, peer-session alternative for a *shared checkout*.
- **uzi**, **claude-squad** — isolation-first: one `git worktree` + `tmux` session per agent, conflicts deferred to `git merge`. They sidestep the shared-checkout collision that Tessera addresses; use them (or Tessera's own `--isolated` mode) when hard isolation is what you want.
