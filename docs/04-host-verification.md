# 04 — Empirical host verification (final-round "fresh research on adversarial data")

Ran the v10 residual `research_needs` as REAL host tests (higher signal than web search). Results:

## CONFIRMED (load-bearing assumptions hold)
- **Kernel 7.0.0-32-qcom-x1e, Ubuntu 26.04 LTS** (aarch64 Qualcomm X-Elite). Very modern ⇒ openat2/RESOLVE_BENEATH (≥5.6), OFD locks (≥3.15) all available.
- **flock(1) 2.41.3**: serialization test PASSED — `flock -x LOCK bash -c 'sleep 3'` holds the lock for the wrapped command's FULL lifetime (concurrent `flock -w1` BLOCKED while held) AND **auto-releases on process death** (acquire succeeded after exit). ⇒ env-set locked-writer design is real + crash-safe. `/proc/locks` shows `FLOCK ADVISORY WRITE <pid> <dev:ino> 0 EOF`.
- **node v24.12.0 `fs.watch`** fires on `O_APPEND` extend (got change events) ⇒ real-time coprocess/`ps --follow` works WITHOUT `inotifywait` (which is MISSING).
- **realpath -m** (uutils coreutils 0.8.0) tolerates not-yet-existing final component AND resolves `..` ⇒ canonicalize() works for `.env-shared` that's only `.example` today.
- **pure-JS FNV-1a 64-bit** hashed 1700 bus lines in **15.5 ms** ⇒ content-hash dedup needs no native xxhash.
- Present: python3 3.14, git 2.53, jq 1.8.1, docker 29.5.3, realpath.

## CHANGES THIS FORCES (simplify — lean, owner pref)
1. **Drop Valkey from the LOCAL design entirely.** docker present but NO valkey container runs locally (it's server-side on mcp-network). File bus is the sole mechanism; Valkey kept only as a noted FUTURE cross-host accelerator.
2. **Drop the detached per-session inotify coprocess from MVP.** It cost ~50MB RSS/session (residual #12) and a PushNotification-from-detached-process unknown (residual #5). Replace with:
   - agent↔agent discovery = SessionStart-announce + PreToolUse-fold (peers learn at next tool boundary — the physical limit since Claude can't be interrupted mid-token, residual #8). NO daemon needed for this.
   - human real-time view = `agentsync ps --follow` running `fs.watch` in the FOREGROUND human process (zero idle daemon).
   - fully-unattended wedge alarm = Phase-2 optional `watch --alarm`.
3. **MISSING tools confirm zero-native-dep stack**: NDJSON (not sqlite3), node `fs.watch` (not inotifywait), JS FNV-1a (not xxhsum). Runtime = node (v24 present) + `flock(1)` + `git` + `tmux` + coreutils. All standard.

## STILL TO CONFIRM (harness-specific — via claude-code-guide agent)
- PreToolUse can DENY each of Edit/Write/NotebookEdit/Bash + exact hook JSON contract.
- FULL set of file-mutation tool names in THIS harness (unhooked surface breaks Tier-1 guarantee).
- Do subagents fire SessionStart / inherit the global hook block? (else parent-announce latch is load-bearing)
- Can a detached process trigger a user push? (suspect NO → confirms dropping coprocess push from MVP; use notify-send or bus-RED-marker fallback)
- tmux present but `tmux --version` returned empty (it uses `-V`); re-verify before relying on it in launcher; launcher must detect+fallback.
