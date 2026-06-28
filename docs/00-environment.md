# 00 — Environment grounding (facts, not generic)

## The terrain
- Root `/home/smoxy/Documents/pj/mcp` is **NOT a git repo**: it's a **polyrepo container** of **16 independent git repos** (each its own `.git`). Two agents on two different repos must stay mutually invisible → **scope = the project (repo) root**, found by walking up to the nearest `.git` (or to the polyrepo root for cross-repo work like `deploy/`).
- Repos: 12 Node.js + 5 Python services (rinoova-mcptool-{backend,frontend,gateway,payment,channels,mailer,composer,builder,cleaner,monitoring,deployer,agent}), `rinoova-mcptool-architecture` (docs/skills), `rinoova-website`, `dummy-auth`, `deploy`.
- Cross-cutting collision zones (multiple agents WILL collide here): `deploy/` (compose.yaml + `.env-*` shared across all services), `.env-shared` + `.env-managed-llm` (3-way: be+agent+payment), `rinoova-mcptool-architecture/docs/` (shared source of truth).

## Existing prior art (DO NOT duplicate — extend it)
- **File-based append-only coordination already exists**: `rinoova-mcptool-architecture/.coordination/log.ndjson` (NDJSON, append-only, durable, audit-trailed) + `inbox/` mirror tree. Schema: `{ts, from, type: announce|add|question|answer|ack|done, ref, msg}`. README explicitly argues file-append-only OVER sockets because agents work async + durability + audit. **This is the seed of the protocol.**
- **anti-drift** skill + AGENTS.md protocol: read-before-write docs via `scripts/docs/relevant.mjs` selector (zero-dep .mjs), non-interference rules between agents (audit agent stages to inbox; anti-drift agent owns framework + integrates). Tag-signals: hot-path → multi-agent+gate, do-not-implement → veto, human-gate → runbook.
- **Valkey** present in `deploy/compose.yaml` (`valkey:8-alpine`, internal `rinoova-mcp-valkey:6379`, 256mb, allkeys-lru). Used by backend (fail-open spend counters via atomic Lua) + payment (fail-closed webhook idempotency). BUT it's a CONTAINER on `mcp-network` — not trivially reachable from host CLI agents unless a port is published. Treat as OPTIONAL tier-2, not the base.
- **bgIsolation worktree guard**: background jobs blocked from writing to shared checkout w/o `worktree.bgIsolation:none`. Job 19a5b79c is BLOCKED on exactly this (21 docs staged, can't land). → A coordination system must make the "who's touching what" visible so this guard is a coordination point, not a dead end.
- Harness today: **NO hooks configured** (user settings.json = `permissions.defaultMode:auto`, theme, push notif). Hooks are an UNUSED integration surface → big opportunity (SessionStart/PreToolUse/PostToolUse/Stop/SubagentStop/SessionEnd).
- Worktrees: `dummy-auth/.claude/worktrees/public-api-split` exists. Jobs live in `/home/smoxy/.claude/jobs/<id>/`; subagent meta in `projects/.../subagents/agent-*.meta.json` (has agentType, spawnDepth, toolUseId).

## Owner preferences (memory)
- **Real-time over polling.** Reuse existing mechanisms. **Don't overengineer.** No Firestore for analytics (Prometheus/Grafana). Valkey/Redis already the real-time layer for payment domain.

## Hard requirements (restated)
1. Per-directory scoping; cross-project invisibility.
2. Real-time announce on unpredictable agent spawn; active peers in same scope notified + coordinate.
3. Low-level / "vettoriale" (→ likely **vector clocks** for concurrency/conflict detection) / fast / cheap / Linux-native.
4. Easy human-gate launcher to start MANY jobs.
5. Optimize time + cost; zero/near-zero idle cost.
6. ≥5 rounds adversarial refinement; stop only when fresh adversarial deep-research yields nothing new.
7. Compact memory ≤500K tokens.

## "Vettoriale" interpretation (lock this)
Most likely = **vector clocks** (orologi vettoriali): the canonical low-level distributed-systems primitive to detect *concurrent* (⇒ potentially conflicting) operations vs causally-ordered ones. Secondary reading: vectorized/SIMD-fast binary protocol. Design will USE vector clocks over the append-only event log for conflict/causality detection; keep wire format compact.
