# 03 — Deep-research findings (compact, cited)

Source: deep-research workflow wco4p3qm0 — 5 angles, 23 sources, 25 claims verified (23 confirmed 3-0, 2 killed). Full: tasks/wco4p3qm0.output.

## VERDICT: recommended stack (daemonless) — strongly confirms hypothesis, sharpens it
Per-project coordination dir = **Linda tuple-centre + append-only NDJSON (lossless source of truth) + inotify "doorbell" + OFD advisory locks + lease-TTL/heartbeat**. Satisfies all 4 reqs:
- (a) per-dir scoping **automatic**: medium lives IN the project dir ⇒ two projects share no medium ⇒ mutually invisible. Grounded in tuple-centre theory: "coordination laws local to a tuple centre but affect the MAS globally; agents not sharing a centre are uncoordinated" (Denti/Omicini [16]). "local laws, global effect."
- (b) real-time announce = append + inotify/socket wake; **reactive tuple spaces** fire on content-condition = push notification (arXiv:1209.1421 [17]).
- (c) low-level/fast/cheap = pure kernel primitives, **zero idle cost, no server**.
- (d) human-gate = launch N CLI procs pointed at same dir; they self-discover via the medium.

## Sharpened primitive choices (corrections to my hypothesis)
1. **OFD locks `F_OFD_SETLK` — NOT flock(2), NOT legacy `F_SETLK`.** OFD binds to the open file description, self-releases on last close (⇒ crash-exit auto-clear), inherited across fork. F_SETLK footguns: closing ANY fd to the file drops ALL the process's locks; not inherited across fork. Man page itself names OFD as the fix [fcntl(2) 12,13]. **Caveat: advisory locks unreliable over NFS → medium MUST be on local FS.**
2. **inotify**: cheap, unprivileged, epoll-able. BUT non-recursive + lossy (drops past max_queued_events, only IN_Q_OVERFLOW guaranteed) + blind to NFS. ⇒ **watch ONLY the single small coord dir**; treat every wake as advisory; **full rescan of log on IN_Q_OVERFLOW**. Log is authoritative, doorbell is a hint.
3. **fanotify** can GATE/BLOCK file ops in real time (FAN_*_PERM→FAN_DENY/EPERM) but needs CAP_SYS_ADMIN/root ⇒ only for a privileged supervisor. **KEY MAPPING: we don't need fanotify gating — Claude's PreToolUse HOOK is our userspace gate (can deny an Edit) with no root.**
4. **Unix sockets** (optional faster doorbell): SOCK_DGRAM reliable+non-reordering on Linux but point-to-point (per-subscriber socket for fan-out); SOCK_SEQPACKET connection-oriented in-order framed; **abstract-namespace** sockets auto-vanish on crash (Linux-only). Pathname socket = discoverable per-dir.
5. **Vector clocks** detect concurrent (vectors not element-wise comparable ⇒ potential conflict) vs causal; Lamport cannot. Confirms "vettoriale"=vector clocks for conflict detection. Keep clocks bounded (prune dead agent ids).
6. **Valkey/Redis**: optional lower-latency/cross-host doorbell via pub/sub, but **fire-and-forget, lost on disconnect ⇒ NEVER source of truth**; use **Streams** for replay. Single host ⇒ no Redlock/quorum (avoid; split-brain avoided by single local medium).

## Existing OSS prior art
- **uzi / claude-squad / Crystal / Conductor / vibe-kanban**: prevent conflicts by **ISOLATION** — git worktree per agent (shared .git object store) + defer all conflict resolution to **git merge/rebase**; observability = **polling** tmux (uzi `ls -w` 1s refresh); **NO IPC bus, NO real-time announce** [uzi 0,1,2]. They SIDESTEP in-directory coordination. ⇒ Reuse worktree isolation as a COMPLEMENTARY layer for genuinely-parallel work; our bus handles the genuinely-SHARED paths (deploy/, docs/, .env-*).
- **Claude-Flow (ruvnet)**: coordinates many Claude Code agents via a **shared SQLite blackboard `.swarm/memory.db`** (12 tables incl. shared_state, events). Direct prior art for the blackboard pattern (but SQLite = single-writer; fsync cost). Validates blackboard-in-project-dir.
- **CodeCRDT** (arXiv:2510.18893): observation-driven coordination for multi-agent LLM codegen; CRDT ⇒ 100% syntactic convergence, **but 5-10% semantic conflicts remain** (duplicate decls, type mismatch, broken refs) ⇒ reconciliation/verify still needed. CRDT overkill for announce/claim; only for genuinely-mergeable docs.

## Runner-up stores
LMDB (daemonless, mmap, multi-PROCESS MVCC, readers lockless, **writers serialized ⇒ deadlock-free**, needs periodic `mdb_reader_check` for stale readers) > SQLite WAL (1 writer, fsync-bound). Both weaker than append-NDJSON for high-churn announce; better when transactional structured state needed.

## Failure modes → mitigations (verified)
- stale lock (crashed agent): OFD self-release on exit + lease-TTL + heartbeat reclaim.
- lost notification: doorbell advisory; reconcile vs append-log; full rescan on IN_Q_OVERFLOW / pubsub reconnect.
- split-brain: single per-project local medium; NO cross-node distributed lock; if Valkey, single doorbell not quorum.
- deadlock: OFD single-holder + try-lock + **jittered backoff**.
- thundering herd: jitter/backoff before woken agents rescan-and-reclaim.

## KILLED claims (don't rely on)
- ✗ CRDT optimistic write-verify "guarantees at-most-one claim" (0-3 refuted) — don't trust optimistic CRDT claiming for mutual exclusion; use OFD locks.
- ✗ "embedding reactions in the medium makes acquisition atomic, preventing deadlock a priori" (1-2 refuted) — reactive medium is not magic; still need explicit locking discipline.

## Open questions carried into final round
1. Real latency/throughput at 10-50 agents; when does inotify-overflow/OFD-contention force Valkey Streams as bus?
2. Claim granularity: per-file vs per-glob vs per-subtree → push toward **tuple-template associative match** so same-project disjoint-path agents stay non-blocking (this is the path-overlap-visibility refinement from 02).
3. Lease-TTL+heartbeat on OFD: enough for safe reclaim w/o double-exec, pure-P2P or needs tiny daemon? Pick interval/TTL avoiding premature reclaim vs long stalls.
