# AgentSync — design record

This folder preserves the full research → design → verification lineage that produced AgentSync. Read order:

1. **`05-spec-generic.md`** — the authoritative, portable spec implemented by the code (v11). Start here.
2. `03-research-findings.md` — deep web research (cited): Linda tuple-centres, OFD/flock, inotify, vector clocks, Redis pub/sub losses, uzi/claude-flow prior art.
3. `04-host-verification.md` — empirical kernel/runtime verification on this host (flock serialization+auto-release, fs.watch on O_APPEND, realpath -m, hash speed, tmux, PreToolUse DENY contract, settings global-merge, subagents-inherit-PreToolUse-not-SessionStart).
4. `00-environment.md`, `02-generalization.md` — grounding + the "portable to every project" reframing.
5. `01-design-hypothesis.md`, `v10-adversarial-spec.md` — the initial hypothesis and the heavy v10 spec from 8 adversarial rounds (rinoova-specific; superseded by 05 after re-generalization + leanness cuts).

## How the design was produced
- **Deep research** (105-agent fan-out, 23 sources, adversarial claim verification).
- **8 rounds of adversarial design refinement** (7-lens critic panel: crash-safety, perf/cost, scope+spawn correctness, operability, simplicity/reuse, security, prior-art) — every round produced material change.
- **Empirical host verification** of every load-bearing primitive (higher signal than more web search).
- **1 final adversarial round** on the re-generalized lean spec → GO with narrow new info → leanness cuts applied.

## Key decisions that survived (and why)
- **Reuse git, don't rebuild it.** Worktree isolation + `git merge` is the conflict gate for *tracked* files. AgentSync adds awareness on top and (opt-in) flock only for the genuinely-shared files git can't merge.
- **Byte-offset is the clock.** One host + one append-only file ⇒ a total order. Vector/Lamport clocks are inert under serialization and unsound to GC — dropped. ("Vettoriale" became conflict *visibility*, not literal clocks.)
- **Append-only NDJSON bus is the source of truth**; any real-time notifier (inotify/`fs.watch`, or future Valkey) is an *advisory* doorbell — reconcile against the log, which is lossless.
- **Per-scope medium ⇒ structural cross-project invisibility** (Linda tuple-centre).
- **Hooks are the integration surface.** PreToolUse can DENY+reroute (verified). The userspace hook replaces the root-only `fanotify` gating the research flagged.
- **Identity:** awareness mode uses the harness `session_id` (hooks are separate short-lived processes, so a kernel pid/starttime triple belongs to the *hook*, not the agent); flock mode uses kernel `/proc/locks` holder + `boot_id:pid:starttime` for kill targeting.
- **Lean by default:** Tier-1 flock apparatus, Bash-redirection gating, and full doctor are opt-in/deferred — a fresh project gets worktree isolation + the awareness bus only.

## Verified, lean, honest
All primitives are empirically confirmed on Linux 7.0 / node 24 / flock 2.41 / git 2.53 / tmux 3.6. The threat model is one uid; same-uid availability and secret-value confidentiality are explicitly **not** defended (stated, not pretended). Linux + local-fs only.
