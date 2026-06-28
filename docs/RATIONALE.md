# Tessera — design rationale

This document explains *why* Tessera is built the way it is: the reasoning behind each decision, the alternatives that were considered and rejected, and the properties that make it fast, lightweight, and trustworthy. If `README.md` is the *what*, this is the *why*.

> **How it was made.** Tessera's design wasn't guessed. It came out of (1) deep research into the relevant primitives and prior art, (2) **eight rounds of adversarial review** in which the design was repeatedly attacked across crash-safety, performance, security, operability, and simplicity — every round changed it materially — and (3) **empirical verification of every load-bearing assumption on a real machine** (advisory-lock semantics, `fs.watch`→inotify behaviour, the hook deny-contract, the cost of a cold hook, etc.). Several first-cut ideas died in that process; the survivors are below, with the reasons they survived.

---

## 1. Goals and constraints

- **Many agents, one shared folder.** The target scenario is several independently-launched local AI coding agents working in the *same* checkout — not one orchestrator fanning out isolated workers.
- **Unpredictable spawns.** Agents appear ad hoc; coordination must require no central registration step.
- **Per-folder scoping.** Agents in different projects must be mutually invisible — no global chatter.
- **Lightweight to the point of invisibility.** It must add no meaningful latency to an agent's work and no idle cost to the machine. If it's noticeable, it won't be used.
- **Reuse, don't reinvent.** Where a great tool already exists (git, the OS), compose it rather than rebuild it.
- **Single host, single user, local filesystem.** This is the honest operating envelope; everything is designed for it (and says so).

---

## 2. The central bet: there are three kinds of conflict

The whole design follows from one observation: when agents collide, the collision is over one of three classes of file, and **two of the three already have excellent tools.**

| Class | Already solved by | So Tessera… |
|---|---|---|
| **Tracked files** (in git) | `git worktree` + real `git merge` | **adopts** git |
| **Awareness** (who's here, what they touch) | *nothing lightweight* | **builds** the shared board |
| **Genuinely-shared, non-mergeable files** (gitignored env, generated singletons) | a `flock` + atomic write | **plans** an opt-in flock mode |

The only genuinely missing piece is *awareness*. Building anything more would be reinventing tools that already work. This is why Tessera is small: it is mostly *glue* plus one thin new layer.

---

## 3. Decision: reuse git for tracked files

For files under version control, the right answer for "two agents, possible conflict" already exists and is battle-tested: give each agent its own **git worktree** and let **`git merge`** (or rebase) reconcile. `tessera up --isolated` does exactly that.

We deliberately did **not** build any merge/diff/3-way logic. Rebuilding git's conflict resolution would be a large, lower-quality reimplementation of a solved problem. The awareness board is for the *shared-checkout* case where you've chosen collaboration over isolation; isolation itself is delegated to git.

---

## 4. Decision: a shared append-only board for awareness

The board is the one thing Tessera builds. Every design choice in it optimizes for *cheap, crash-safe, lossless awareness*.

### 4.1 Why a file, not a daemon / socket / database

- **No daemon.** A background service has idle cost, a lifecycle to manage, crash-recovery to get right, and a thing to install and monitor. A plain file has none of that. The board exists only as bytes on disk; when no agent is active, *nothing is running*.
- **Not a Unix socket as the source of truth.** Sockets are point-to-point and ephemeral: a late-joining or restarted agent misses everything sent before it connected. Awareness has to survive reconnection and replay, which a stream of past announcements (a log) gives for free.
- **Not SQLite/Redis as the base.** A shared SQLite *blackboard* is real prior art (claude-flow uses one) and Redis/Valkey is tempting, but both are heavier than the problem: SQLite serializes writers and adds fsync latency on the hot path; Redis is a network service that, on a single host, you'd have to run and reach. The append-only file is lighter and has *zero* operational surface. (Redis/Valkey is noted as an *optional* future accelerator for the multi-host case — never as the source of truth, because its pub/sub is fire-and-forget and drops events on disconnect.)

### 4.2 Why append-only NDJSON

One JSON object per line, only ever appended. Appending (never rewriting) is what makes concurrent multi-writer access safe without a lock: on Linux an `O_APPEND` write of a record well under `PIPE_BUF` is atomic, so many agents can append at once and no record interleaves with another. NDJSON is trivially parseable, greppable, and human-readable — you can `cat` the board and understand it.

### 4.3 The board is the source of truth; the notifier is only a doorbell

Real-time delivery uses Node's `fs.watch` (inotify under the hood). But inotify is **lossy** — it can coalesce or drop events under load. So we never *trust* the notification to carry data. The watch is only a *doorbell*: when it rings, agents re-read the log from where they left off and reconcile. The log is authoritative; the doorbell is a hint. This is the single most important robustness decision — it means a missed notification can never cause missed coordination.

### 4.4 Crash-safety: leading-newline framing

A process can die (or hit `ENOSPC`) mid-write, leaving a torn record. To make that harmless, every record is written as `"\n" + json` — the newline goes *first*. The stream is therefore `\n{A}\n{B}\n{C}`. If `{A}` tears and the next writer appends `\n{B}`, the bytes become `\n{Apartial\n{B}`; splitting on `\n` yields `{Apartial` (which fails `JSON.parse` and is discarded) and an intact `{B}`. **A torn write can never corrupt or hide its successor.** The reader is also deduplicated (so re-reads don't re-fire events) and built with `Map`/`Object.create(null)` so hostile keys like `__proto__` can't poison it.

---

## 5. Decision: no clocks — byte-offset *is* the order

A natural instinct for "detect concurrent edits" is **vector clocks** (or Lamport timestamps). We tried that, and the adversarial review killed it:

- On a **single host with one append-only file**, the byte offset of a record already establishes a **total order** of events. A second ordering mechanism adds nothing.
- Vector clocks **grow with every agent id ever seen** and have no safe garbage-collection story for transient, unpredictably-named agents — they'd leak.
- Under serialized appends they are simply inert.

So there are no clocks. What the user actually wants — "did these two collide?" — is answered by **content** (two live agents whose recorded paths overlap), surfaced *before* the write by the hook and *visibly* on the board. ("Vettoriale" in the original brief was reinterpreted: the deliverable is conflict *visibility*, not a vector clock.)

---

## 6. Decision: the gate is a Claude hook (not fanotify, not a wrapper)

To actually *stop* a clobber (not just log it), something must intervene *before* the write. The OS way to gate a file operation is `fanotify` with permission events — but that needs `CAP_SYS_ADMIN`/root and is far too heavy for an unprivileged dev tool.

Claude Code's **`PreToolUse` hook** gives the same power in userspace, for free: it runs before each `Edit`/`Write`/`NotebookEdit`, can read the target path, and can **deny** the call (returning a reason the model acts on) or, by default, simply warn. No privileges, no kernel tricks. The hook is also why **no agent has to cooperate**: coordination is wired into the tool boundary, not into the agent's prompt or behaviour.

---

## 7. Decision: identity is the session, not a kernel pid

Awareness keys each agent on the **Claude session id**. This is forced by a subtle reality: **hooks run as separate, short-lived processes** from the agent. A kernel identity (pid/start-time) captured in a hook would identify the *hook process*, not the agent — useless across the agent's lifetime. The session id, by contrast, is stable across all of a session's hook invocations.

A corollary, verified by a live test: a single session's **sub-agents share that session's id**. That's correct for the use case — a session and its sub-agents are *one* unit of work, and Claude already partitions their files. Tessera coordinates *separate* sessions, which is exactly the "many agents on a folder" scenario. (The opt-in flock mode, where a real kill target is needed, uses kernel `/proc/locks` holders instead — the right identity for that job.)

---

## 8. Decision: per-folder scope = structural invisibility

The board lives *inside* the project (`<scope>/.tessera/`). This isn't just tidy — it's the mechanism for scoping. Two agents share a medium **only if** the paths they touch resolve into the same scope directory; agents in different projects share no file and so are mutually invisible **by construction**, with nothing to enforce.

This is the **tuple-space / blackboard** property from coordination theory (Linda): coordination laws are local to a medium but affect the whole system, and parties not sharing a medium are simply uncoordinated. Scope is the nearest ancestor with a marker (`.git`, `package.json`, `go.mod`, …, or an explicit `.tessera-scope`), chosen **distance-first** so a monorepo's sub-projects stay independent.

---

## 9. Why it's lightweight (the cost budget)

This was a hard requirement, so it was measured, not assumed:

- **Projects that don't use Tessera pay ~nothing.** The global hook is a tiny **shell pre-filter** that checks for a `.tessera/` directory and exits in about a millisecond — Node never even starts. So installing it globally doesn't tax your everyday repos.
- **Participating projects pay a cold hook only at the tool boundary.** The handler is a short, dependency-free Node script. There is no work added *inside* the agent's reasoning — it doesn't read, write, or "think about" Tessera.
- **Idle cost is zero.** With no active agent, nothing runs: no daemon, no poller, no watcher. The board is just bytes at rest.
- **The hot path has no fsync and no lock.** Appends are atomic by virtue of `O_APPEND`; the awareness board never calls `fsync` (durability is re-established by re-announcing at session start). The only place fsync appears is the opt-in flock writer, which isn't in the default path.

The guiding principle: *if it were noticeable, it wouldn't get adopted.* Every choice above trades cleverness for staying out of the way.

---

## 10. Threat model — and what we deliberately don't defend

Tessera is honest about its envelope: **one host, one user, local filesystem.** Within that it **defends two things**: the integrity of the data it writes (atomic, framed, crash-safe), and correct teardown targeting (it never signals a process based on self-reported, spoofable ids).

It **does not** pretend to defend:
- **A malicious same-user process.** Anything running as you can write the same files; a coordination tool can't change that, and claiming otherwise would be theater.
- **Secret *values*.** The board records *which* file or key is being touched, never its contents; and `/proc/<pid>/environ` is readable by the same user anyway.
- **Cross-machine coordination.** Today's board is a single local file. Multi-host is a planned, optional network layer (see `ROADMAP.md`), not a present claim.

Stating these limits plainly is itself a design choice: a security story you can't actually deliver is worse than an honest boundary.

---

## 11. What we tried and rejected

| Considered | Why it was dropped |
|---|---|
| **Vector / Lamport clocks** | Inert under single-host serialized appends; unbounded growth, no safe GC. Byte-offset already orders events. |
| **A coordination daemon** | Idle cost, lifecycle, crash recovery, a thing to install/monitor — all avoidable with a file. |
| **Unix socket as the truth** | Ephemeral and point-to-point; misses replay for late joiners. Kept only as an optional faster doorbell idea. |
| **SQLite / Redis blackboard as the base** | Heavier than the problem (writer serialization + fsync, or a network service). Append-only file is lighter and zero-ops. |
| **`fanotify` gating** | Needs root. The `PreToolUse` hook gives the same gate in userspace. |
| **A standalone parallel coordination dir** | Reuses any existing convention instead; one medium, not two. |
| **CRDTs for a mergeable shared doc** | Converge syntactically but still leave semantic conflicts; overkill for announce/claim. |
| **Building the flock tier by default** | Most projects have no genuinely-shared, non-mergeable file. Shipping it on would be weight nobody pays for; it's opt-in. |

---

## 12. How the quality was earned (the process)

The reason to trust the design isn't a claim — it's the method:

1. **Research** mapped the primitives (advisory locks, inotify/fanotify, Unix sockets, tuple spaces, append logs vs Redis) and the prior art (uzi, claude-squad, vibe-kanban, Conductor, claude-flow) so the design reused proven ideas and avoided reinventing.
2. **Eight adversarial rounds** attacked each draft from independent angles (crash-safety, performance/cost, the core scope+spawn requirement, operability, simplicity/reuse, security, build-vs-adopt). Each round produced concrete fixes — and cuts. The design got *smaller* as it got better.
3. **Empirical verification** confirmed every load-bearing assumption on a real machine before it was relied on, and a **final review pass** plus a **live multi-agent test** validated the result and caught real bugs.

The output is intentionally minimal: a few hundred lines of dependency-free code that compose `git`, `flock`, inotify, `tmux`, and NDJSON, applying a coordination model with a 30-year pedigree. The smallness *is* the quality.

---

## 13. Accepted tradeoffs

- **Reaction is bounded by the next tool boundary.** An agent learns of a peer at its next hook firing, not mid-thought — because an LLM can't be interrupted mid-token. Same-file work is steered toward worktree isolation so this window carries no data-loss risk, but the latency is real and disclosed.
- **Sub-agents of one session aren't cross-flagged with each other.** By design (they're one unit of work); cross-*session* coordination is the target and is delivered.
- **Linux + local FS only.** Advisory locks and inotify are unreliable on NFS; the design says so rather than degrade silently.

These are the honest edges of a tool that chose to be small, fast, and truthful over being all-encompassing.
