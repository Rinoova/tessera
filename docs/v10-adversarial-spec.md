This is a synthesis task. I have the full design context from 8 adversarial rounds. I'll write the definitive spec directly as my final response — no files, no tools needed.

# AgentSync — Definitive Implementation Spec (v10, post-round-8 consolidation)

Per-scope coordination for unpredictably-spawned Claude Code agents on a single-uid Linux host (POLYROOT = 16 independent git repos under `/home/smoxy/Documents/pj/mcp`, non-git). Daemonless, reuse-first, crash-safe.

---

## 1. Architecture overview

**One idea:** every coordination fact is either (a) a kernel primitive (`flock(2)`, `/proc/locks`, `/proc/<pid>` liveness) — the *authoritative* layer — or (b) an append line in a per-scope NDJSON bus — the *advisory/display* layer. Nothing self-written by an agent is ever a kill, exclusion, or attribution input.

**Three coordination mechanisms, matched to file class:**

| File class | Gate | Mechanism |
|---|---|---|
| Tracked files (`compose.yaml`, `docs/index.json`, source) | real `git merge` across worktrees | Tier-0 isolation (default for ALL scopes incl. deploy, mixed mode) |
| Gitignored shared env (`deploy/.env-shared`, `.env-managed-llm`) | `flock(2)` on a permanent sidecar + atomic rename, mutation funneled through `agentsync env-set` | Tier-1a — the only kernel-hard write path |
| Everything else | advisory log-fold overlap warning | Tier-1b — bus only, last-writer-wins, honestly labeled |

**Scope** = nearest project root (walk realpath up to `.git`); cross-repo work (deploy/, loose polyroot files) = polyroot, keyed `_root_`.

**Discovery** = (1) a GLOBAL lightweight `SessionStart`/`PreToolUse` announce-and-fold hook installed once in `~/.claude` (fires in any repo, ~42 ms node cold start + <2 ms tail fold); (2) a per-session detached inotify coprocess giving the human real-time `ps --follow` + push; (3) kernel-hard `flock` at edit time for Tier-1a. Agent-to-agent *reaction* is bounded by the peer's next tool boundary (Claude cannot be interrupted mid-token) — this is disclosed, not papered over.

**"Vettoriale" without clocks:** single host + one per-scope append-only file ⇒ **byte-offset is a total order**. No Lamport scalar, no vector clock — both are inert under flock serialization and unsound to GC. Conflict *visibility* (not a clock) is the deliverable: surfaced **before** the fact by `up --dry-run` (structural compose-membership convergence) and **during** by flock read-modify-write serialization. There is no runtime `conflict` row.

---

## 2. Trust boundary (the axioms that survived 8 rounds)

- **Trust boundary = ONE uid.** Adversary = a prompt-injected/buggy agent as that uid.
- **Defended invariants (only these):** (1) **data integrity** — flock serialization + atomic rename of the authoritative mutation; (2) **correct kill targeting** — kernel-derived holder pid + pgrp, re-validated by `boot_id`+`starttime`.
- **NOT defended (stated plainly, zero build effort spent pretending otherwise):** same-uid availability (flock parking, bus flood, `agents/` flood — all human-kill-only, surfaced RED); secret *value* confidentiality (`/proc/*/environ|cmdline|mem` is same-uid readable; co-writer skills already append prose to the bus); hook-tamper and audit-log immutability (doctor's hash check catches *non-adversarial drift only*).
- **git is prior art — do not rebuild it.** Worktree isolation + real `git merge` is the default gate for tracked files. flock covers ONLY the genuinely-untracked, genuinely-shared residue git cannot merge: the 2 gitignored env files.
- **ONE bus, reused literally.** Canonical record stays `.coordination/log.ndjson`. Co-writers (anti-drift/audit skills) bypass agentsync and emit raw NL prose >120 chars — so the bus is **gitignored + dockerignored** and parsed **defensively** (it is untrusted prose).

---

## 3. On-disk layout — exact

Reuses the existing live `.coordination/` dir. Machine state lives in a `.state/` sibling.

```
<scope-root>/.coordination/
  README.md  AUDIT_FINDINGS.md  inbox/      # EXISTING human artifacts — STAY TRACKED (committable)
  log.ndjson                                 # THE BUS: append-only NDJSON, 0600, GITIGNORED+DOCKERIGNORED
  .state/                                    # agentsync machine-only state; mode 0700, gitignored+dockerignored
    agents/<agent-id>                         #   per-agent presence + fold cursor (plain text, see 3.2)
    locks/<enc(key)>.lock                     #   PERMANENT flock sidecar; never unlinked, never gc'd
    locks/<enc(key)>.owner                    #   DISPLAY/alias-check ONLY — never a kill input
    gate.lock                                 #   per-scope launch / --after / gc serialization sidecar
<POLYROOT>/.coordination/...                  # the "_root_" scope (POLYROOT is non-git ⇒ no gitignore needed there)
```

`install`'s **very first action**: append to each touched scope-root's `.gitignore` AND `.dockerignore` exactly two lines — `.coordination/log.ndjson` and `.coordination/.state/` — leaving README/AUDIT_FINDINGS/inbox tracked. doctor FAILS CLOSED until `git check-ignore .coordination/log.ndjson` confirms ignore in every touched scope.

### 3.1 `events.ndjson` line schema (the bus record)

One JSON object per line. **Framing: every record is written as `"\n" + json`** (leading delimiter — see 4.1). Reader is schema-tolerant.

```jsonc
{
  "ts":      "2026-06-28T14:03:11.402Z",  // wall clock — DISPLAY ONLY; order = byte-offset
  "from":    "<boot_id>:<pid>:<starttime>", // agent-id; validated /^[0-9a-f-]+:\d+:\d+$/ before any keyed/proc use
  "type":    "announce|edit|lock-acquire|lock-release|done|question|answer|ack",
  "ref":     "deploy/.env-shared | docs/index.json | KEY_NAME",  // scope-relative path/glob, or env KEY-NAME (never value)
  "msg":     "wave3.be.2 editing compose",  // ≤120 chars, no NL/tab for agentsync writes (co-writers may exceed)
  "pid":     48213,
  "pgid":    48200,                        // DISPLAY hint only — NEVER a kill input
  "start":   90324718,                     // starttime field 22, comm-safe parsed (see 5)
  "boot_id": "f3c8...e1",
  "rid":     "<boot_id>:<agent-id>:<n>"    // IMMUTABLE per-record id; n = process-LOCAL monotonic counter
}
```

**There is NO vector-clock field and NO `seq` field.** This is deliberate and survived every round: byte-offset is the single host's total order; `rid` (or, for the rid-less legacy corpus, a content-hash) is the dedup key. A reader that wants causal ordering reads top-to-bottom — that IS the clock.

- `rid` is minted ONCE by the writer, never recomputed.
- Legacy lines lacking `type` map via a 5-line adapter `{actor,event,file}→{from,type,ref}`.
- Legacy lines lacking `rid` get a **content-derived** synthetic id `xxh64(trimmed-bytes)` — stable across inode/offset change (gc), identical in orphan-vs-live copies. (NOT position-derived — that double-counts across gc.)

### 3.2 `agents/<agent-id>` (presence + cursor)

Plain text, single line: `consumed_inode consumed_offset boot_id label`
- Written with plain `O_TRUNC writeSync`, **NO fsync, NO dir-fsync** — the cursor is a rebuildable optimization (on crash, next session cold-reads the 256 KiB tail and dedups by rid/content-hash).
- Created by the agent at SessionStart AND by a parent on a child's behalf at `setpgid` (spawn-time presence).

### 3.3 `locks/<enc(key)>.lock` (flock sidecar)

Empty permanent file. `enc(key)` = percent-encode every byte outside `[A-Za-z0-9._-]` (including `/`); forbid empty/`.`/`..`. Injective, separator-free, traversal-free (load-bearing: `flock(1)` opens it by path). Key = `canonicalize(target)` relative path. doctor asserts `enc()` keys pairwise-distinct, `st_nlink==1`, no two Tier-1a paths share `(st_dev,st_ino)`, no Tier-1a key maps to >1 live inode.

### 3.4 `locks/<enc(key)>.owner`

Display/alias-check only (holder label, scope:path). NEVER read for liveness or kill — those come from `/proc/locks`.

---

## 4. Syscall / primitive choices (the rationale that survived review)

| Primitive | Choice | Why it survived |
|---|---|---|
| **Mutual exclusion** | `flock(1)` argv-wrapper (`flock -w T -x LOCK node env-write.mjs`), **never `-c`/shell** | Node has no `flockSync` binding (verified). argv form avoids shell injection. Lock fd inherited by `node` **non-CLOEXEC by default** ⇒ lock genuinely spans the write. (Round 8 deleted the self-contradictory blanket-O_CLOEXEC assertion that would have released the lock at exec.) |
| **Lock identity** | permanent **path-keyed sidecar**, never the data file | Atomic temp→rename churns the data inode every write; a dev:ino-keyed lock would split agents across disjoint sidecars = zero exclusion. Path-keying also predates `.example`→real and survives delete+recreate. |
| **Authoritative write** | `O_NOFOLLOW` open of data file → apply one `key=value` → `fsync(temp)` → `rename` → `fsync(parent dir)` | Only place fsync is claimed (~0.9 ms measured, budget 3.8 ms). Atomic rename = crash-safe env file. `O_NOFOLLOW` defeats swapped-symlink redirect. |
| **Holder identity / kill target** | `/proc/locks` `FLOCK` line → holder pid; pgrp = **field 5 of `/proc/<holder>/stat`**, re-validated `starttime`+`boot_id` | Kernel-only. NEVER the self-written `pgid`. Defeats spoofed-attribution wrong-kill. |
| **Liveness** | `boot_id` FIRST (foreign boot_id ⇒ unconditionally dead), then `/proc/<pid>` exists AND `starttime` matches | pid-alive (same boot) is a hard veto on auto-reaping (SIGSTOP'd/swapped agents survive). Wall-clock TTL is never authority. |
| **Bus append** | one `writeSync(fd, "\n"+line)` on `O_APPEND|O_CLOEXEC|O_NOFOLLOW`, line ≤16 KiB | Durability = page-cache (re-announce at SessionStart). No fsync on the bus. (Round 8 deleted statvfs reservation, degraded-writer SM, write-side MAXLINE.) |
| **Path containment** | scope-root pinned dirfd at SessionStart; `openat2(2) RESOLVE_BENEATH\|RESOLVE_NO_SYMLINKS` when present, else realpath-prefix assert | Belt-and-suspenders against symlink-swap TOCTOU. |
| **Real-time human view** | per-session `fs.watch` (built-in inotify, no `inotifywait` binary) | Honors owner's "real-time over polling"; zero added dependency. |

### 4.1 Leading-delimiter framing (the crash-safety win)

Stream is `\n{A}\n{B}\n{C}`. A torn predecessor self-heals: if A tears mid-write (`\n{Apar`) and B appends (`\n{B}`), stream = `\n{Apar\n{B}` → split on `\n` → `["", "{Apar", "{B}"]` → `{Apar` fails `JSON.parse` and is **discarded**, `{B}` **survives**. A torn writer can never delete an innocent successor's committed record. On short write / ENOSPC: do NOT retry the remainder (it would interleave) — the reader's discard absorbs the fragment.

### 4.2 Reader (schema-tolerant, newline-authoritative, poison-resistant)

Track `(st_dev,st_ino,offset)`:
- Split unconsumed buffer on `0x0A`. Hold trailing partial capped at `MAXLINE=64 KiB` (read-side only); at cap with no newline → discard, fast-forward to next `0x0A`, emit `oversize-line-dropped`. `JSON.parse` each segment; on failure DISCARD and resume.
- **Prototype-pollution defense:** every map keyed by bus strings (`from`, `ref`, `label`) is a `Map` or `Object.create(null)`. `from` validated against the triple regex BEFORE keying or `/proc` liveness; non-matching stays display-only.
- inode CHANGED (only via offline `doctor --gc`) ⇒ cold-read fresh inode from 0; dedup by rid/content-hash so events don't re-fire. **The live bus is NEVER rewritten in place.**

---

## 5. Identity & liveness details

- **agent-id = `${boot_id}:${pid}:${starttime}`.** starttime = `/proc/<pid>/stat` field 22, parsed **after the LAST `)`** (comm may contain spaces/`)`, e.g. `(foo) bar` — naive split misreads it → false dead/alive).
- **Short label:** `up` assigns `wave<N>.<svc>.<i>` (e.g. `wave3.be.2`), stored in `agents/<id>`. `ps`/`kill` accept label or full triple; the kernel triple is the re-validation authority, label is an index.
- **Reboot sweep** (at `up`/`doctor`/SessionStart): reap ALL foreign-boot_id durable state. pid-alive (same boot) is a hard veto.
- **Legacy/foreign non-triple `from`** = display-only, NEVER `/proc`-probed, excluded from keyed structures.
- **`agents/` fold is flood-bounded:** fold only triple-regex-valid AND `/proc`-live ids, capped at N; overflow ⇒ `agents-dir-flood` RED. `doctor --gc` removes forged-id files.

---

## 6. Hook wiring

ONE zero-dep `.mjs` reads hook JSON from stdin, `JSON.parse`s, passes `file_path`/`content` as **data only — never `sh -c`**. The sh wrapper is trivial (`exec node`).

| Hook | Scope | Checks | Emits | Decision |
|---|---|---|---|---|
| **SessionStart** | global (`~/.claude`) | resolve `scope(cwd)`; consume `AGENTSYNC_TOUCHES` from `up` | `announce` in EVERY resolved scope; create `agents/<id>`; spawn the inotify coprocess | always proceed (publish-before-read invariant: announce + `agents/<id>` written BEFORE the discovery fold) |
| **PreToolUse(Edit\|Write\|MultiEdit\|NotebookEdit\|MCP-fs)** | global | realpath target → scope; re-classify Tier-1a at edit time (O(1), page-cached); incremental fold ∩ /proc for overlap | first-PreToolUse announce latch; overlap warning | **Tier-1a target ⇒ DENY** + structured steer to `env-set` (see 7). Else **warn-only, never deny.** |
| **PreToolUse(Bash)** | global where Tier-1a non-empty | parse redirection/argv targets (`echo>>`, `sed -i`, `tee -a`, `cat>`, `printf>>`); realpath each | — | any target resolving under a live Tier-1a path ⇒ **DENY** + env-set steer. **Fail-closed on any unparseable redirection touching a Tier-1a dir.** |
| **Stop / SubagentStop** | global | one final fold; `--shared` baseline-diff vs `up`-captured size baseline | late-peer surfacing; clobber push if a baseline shrank/changed | — |

**Tier-1a DENY message (verbatim contract):** *"This is a shared coordinated env file. Apply your change with `agentsync env-set KEY=VALUE` (value read from stdin), one call per key. Your write was not applied."*

**Why DENY, not advise:** a PreToolUse hook cannot hold a flock across the native edit Claude performs. The flock must contain the *authoritative* mutation, so the native write is refused and re-routed through the single locked writer. doctor asserts **no native-tool code path reaches a Tier-1a realpath** (probes each tool against a temp Tier-1a-shaped path, asserts DENY).

### 6.1 Per-session inotify coprocess (MVP)

At SessionStart, spawn ONE detached node coprocess on `$XDG_RUNTIME_DIR`, one `fs.watch` instance watching the resolved scopes' `log.ndjson` + `.state/agents/`:
- re-folds within ms on `IN_MODIFY`/`IN_CREATE` (the inotify event IS the push — no separate FIFO byte needed); feeds `ps --follow`.
- **5 s kernel-truth tick** over `/proc/locks` holders + holder `/proc/<pid>/stat` state/utime to catch an **event-less** wedge (D-state / non-advancing parked holder). The one justified poll — a wedge produces no file event.
- fires ONE `PushNotification` per RED transition (non-advancing parked holder, ENOSPC-on-rename, worktree-add failure, `--shared` clobber) with per-`(scope,condition)` flap debounce.
- `IN_Q_OVERFLOW` ⇒ full rescan resuming dedup from the persisted content-hash set (does not re-fire the tail).
- idle = zero CPU (blocked on inotify); **~50 MB RSS/session (disclosed, NOT "zero idle")**; self-exits after 5 min no-edits, respawns lazily on next hook.
- **Fallback:** `agentsync watch --alarm` — one foreground loop for fully-unattended waves where no session coprocess covers a wedged scope.

**Cost (measured):** advisory PreToolUse ≈ 42 ms node cold start + <2 ms tail fold (a docs-heavy 50-edit agent pays ~0.5–2.1 s session-total). Tier-1a `env-set` ≈ flock acquire (parked ~0 CPU) + fork + 2×fsync ≈ 5–7.6 ms. Idle = 0 CPU at true rest.

---

## 7. `env-set` — the single locked writer

```
agentsync env-set KEY=VALUE         # VALUE actually read from stdin
  → flock -w 45 -x .state/locks/<enc(canonical(KEY's file))>.lock \
        node env-write.mjs KEY      # argv form; VALUE on stdin
        → open data file O_NOFOLLOW
        → apply single key=value
        → fsync(temp) → rename → fsync(parent dir)
        → emit `edit` event with KEY-NAME only (value forbidden in bus)
        → exit ⇒ flock releases
```
- Reads VALUE from stdin (cheap argv-leak avoidance — **not** a security claim; §2 concedes value confidentiality is undefended). No fd-3 dance, no `PR_SET_DUMPABLE`, no `RLIMIT_CORE`, no key-name allowlist, no entropy scrub (all deleted round 8 — they hardened agentsync's own writes against a threat it cannot stop, into a gitignored file co-writers already flood).
- **Canonical acquisition order = sorted by `enc(key)`** ⇒ no ABBA deadlock.
- **Wait disposition = SERIALIZE, deny only on dead.** Blocking `flock -w 45` parks at ~0 CPU; a granted waiter costs ~7.6 ms, not an LLM round-trip. DENY only when the holder is kernel-confirmed dead/wedged; on deny return holder label + `scope:path` + "WAIT and re-attempt at your next step; do not change strategy" + a token-bucket retry cap.
- **Self-watchdog:** `env-write.mjs` takes a bounded `-w` on its own write step and self-aborts if it cannot complete ⇒ a buggy (non-malicious) holder self-releases without a human.
- **D-state holder is wait-only** (SIGKILL pends until kernel I/O returns; ext4 fsync makes this ~ms-transient) — runbook states D-state is not a `kill` target.

---

## 8. Worktrees vs shared-checkout — the build/adopt/hybrid recommendation

**Recommendation: HYBRID. Default to worktree isolation (mixed mode) for EVERY scope; reserve a narrow, honestly-labeled shared-checkout mode; build only the env-file flock arbiter + the bus + the launcher glue.**

- **Tier-0 isolation is the default for ALL multi-agent work, including deploy and polyroot.** Each job ⇒ `git worktree` + branch; `git merge`/`rebase` is the real gate for tracked files.
- **Mixed mode for deploy** (the round-8 fix): in a worktree job, `canonicalize()` redirects gitignored env-file writes to the **canonical main checkout under flock**, while tracked files (compose.yaml, docs/index.json) live in the worktree and **merge normally**. Result: `deploy/compose.yaml` finally has a real git-merge gate; `deploy/.env-*` keep flock serialization on the one shared physical file.
- **Tier-1b `--shared` (single checkout)** is a narrow opt-in for explicit live handoff: tracked Edit/Write advisory, last-writer-wins, **no detection** — gate-labeled "advisory / LWW / no detection". Crash-time clobber is surfaced via the Stop-time baseline-diff. The real gate for same-file work is `git merge` ⇒ use Tier-0.

**ADOPT, don't build:** session spawn/list/kill via **tmux** (`tmux new-window`/`tmux kill-window`); **git worktree** for isolation; **SOPS** as the explicitly-optional endgame that retires the flock arbiter entirely (see 11). Route ALL dashboard growth (delta engine, board view, multi-wave status at 15–20 jobs) to **adopting vibe-kanban / Conductor / claude-squad when scale materializes**, injecting the hooks + preview as the collision plugin (they fire under any spawner, keyed on the checkout root).

**REJECTED:** Dagger/container-use (isolates the host env — opposite of the requirement); git-crypt for env files (opaque whole-file blobs conflict on every concurrent change, defeating merge-as-gate).

---

## 9. Launcher CLI surface (5 verbs, thin delta over tmux + git + the bus)

```
agentsync install [--global|--scope X] [--uninstall] [--eliminate] [--sops]
    DEFAULT = GLOBAL lightweight announce/fold (~/.claude) + per-project flock/env-set into live
    collision scopes; `up` auto-extends per-project on first launch. FIRST action = narrow
    gitignore+dockerignore. Never rewrites the bus. --eliminate = git mv the 6 loose polyroot docs.
    --sops = separate optional wizard + runbook + round-trip-decrypt doctor check.

agentsync doctor [--gc] [--refresh-hook-hash]
    Slimmed FAIL/WARN split (see 9.1). PRINTS the derived Tier-1a set. `up` refuses on FAIL.
    --gc REFUSES unless the scope has ZERO /proc-live announced agents (true OFFLINE compaction;
    the lockless O_APPEND path cannot be safely swapped under live writers). Under gate.lock: build
    new inode, stamp rid=compacted:<content-hash> into rid-less records, fold orphans by content-hash,
    dedup, atomic swap. Sidecars NEVER in gc scope. Crash-mid-gc: fold {live + orphan temp} by hash, unlink.

agentsync up --scope X --task "..." [--touches ...|auto] [--isolated|--shared] [--after <id|scope:path>]
             [--dry-run] [--yes] [--ack-warns] [--on-worktree-fail=rollback|keep] -n K
    DEFAULT --isolated (worktree+branch) for EVERY scope incl. deploy (mixed mode). Runs preview + confirm first.
    --dry-run = the preview gate as a stop-after (replaces a standalone `preview` verb):
        STRUCTURAL gate — Tier-1a auto-flag from COMPOSE SERVICE MEMBERSHIP regardless of --touches
        (be+agent ⇒ RED .env-shared; be+pa+agent ⇒ RED .env-managed-llm; --touches only NARROWS).
        TRACKED shared files: pairwise wave convergence ∩ historical per-file hit-rate from the bus;
        same-repo same-file pairs YELLOW labeled "same-repo isolated: git-merge".
        Per-pair label: cross-repo isolated / same-repo isolated:git-merge / --shared:ADVISORY-LWW-no-detection.
        COST MODEL: SERIALIZE = queue_depth × hold_floor(fork + 2×fsync inside lock);
                    DENY (dead holder only) ≥ queue_depth × ~1 LLM round-trip.
        Footer: "declared footprint only — runtime enforced at edit time."
    --yes (unattended) STILL runs preview: writes RED/YELLOW summary to bus+stdout AND fires ONE
        PushNotification at launch on any predicted RED convergence.
    Assigns label wave<N>.<svc>.<i>. --after = `flock -w T gate.lock`. tmux new-window per job.
    parent announces + creates agents/<child-id>. --on-worktree-fail makes rollback NON-BLOCKING.

agentsync ps [--scope X] [--problems] [--follow]
    SINGLE PANE, short-label primary column: /proc-verified live agents; per-Tier-1a flock holder
    (kernel /proc/locks pid + kernel-derived pgrp — never .owner/bus pgid); wait depth; WAVE roll-up
    ("wave3: 7/10 done, 2 queued on .env-managed-llm, 1 parked"); lapped-consumer row;
    env-write-redirected-to-main note; agents-dir-flood RED. PARKED-HOLDER RED only when NON-ADVANCING
    (kernel utime/wchan/state — bus 'stuck' is display-only). NO conflict row. --follow backed by the
    inotify coprocess (real-time, NOT watch -n2). --problems filters to RED/parked for 15-20 job waves.
    EACH row prints its ready-to-paste `agentsync kill <label>`.

agentsync kill <label|triple>
    The SAFE human teardown. PRIMARY target = the LABELED agent. Resolves label → recorded
    (boot_id,pid,starttime); RE-VALIDATES starttime+boot_id; derives pgrp = /proc/<pid>/stat field 5
    (NEVER bus pgid); signals that pgrp. Works for ANY runaway regardless of locks. ADDITIONAL safety
    layer when the target holds a Tier-1a sidecar: also resolve+re-validate the /proc/locks holder
    (kernel auto-releases the flock on death). Logs who + kernel-verified target + result.
    Raw `tmux kill-window` is NEVER the documented path. D-state target = wait-only, refused with a note.
```

`status`/`--clobbers` are NOT verbs — documented `jq` snippets over the bus + the `up`-captured baseline (auto-diffed on Stop by the coprocess). `env-set` (7) is the sixth command but is agent-facing (invoked by the DENY steer), not a human launcher verb.

### 9.1 `doctor` FAIL/WARN split

**FAIL (integrity, fail-closed, blocks `up` for touched scopes):**
1. `log.ndjson` + `.state/` gitignored AND dockerignored (`git check-ignore` confirms — the one confirmed-live CRIT, bus is committable today).
2. structural worktree `.git` classification (so default `--isolated` doesn't brick on this host; doctor self-test creates a throwaway worktree and asserts GREEN).
3. lock-key == scope == bus-path equality (single `canonicalize()`).
4. no hardlink / `(dev,ino)` / bind alias on the env sidecars + no Tier-1a key→>1 inode.
5. `/proc/locks` holder == kernel-pid & kill path has zero bus-sourced pid/pgid.
6. no native-tool code path reaches a Tier-1a realpath (all of Edit/Write/MultiEdit/NotebookEdit/Bash/MCP-fs DENY+steer); PreToolUse(Bash) installed where Tier-1a non-empty.
7. publish-before-read ordering.
8. reader survives `__proto__`/`constructor` fuzz.
9. bgIsolation allowlist covers the live Tier-1a set.

**WARN (proceed with `up --ack-warns`, ack logged):** dockerignore on unrelated repos; compose-mtime drift; nested `.git` outside touched scopes; settings.json/`.mjs` hook content-hash mismatch (non-adversarial drift only); `--gc`-eligible dead state; **a collision scope lacking a hook** (any scope whose `log.ndjson` shows recent multi-agent activity, or any repo with ≥2 worktrees, but no installed pieces → "run `agentsync install --scope X`"). Topology is **discovered, not hardcoded to today's 3 zones.**

**Scope-gating:** `up` evaluates FAIL only for scopes it touches; bare `doctor` reports the whole 16-repo picture (closes a global fail-closed self-DoS).

---

## 10. `canonicalize()` and `scope()` (the single path function)

```
canonicalize(target):
  p = realpath_m(target)          # realpath -m semantics: resolve symlinks/binds but TOLERATE a
                                   #   not-yet-existing final component (deploy/.env-shared is only .example
                                   #   today; libc realpath(3) ENOENTs — helpers MUST use realpath -m / parent+basename)
  ASSERT p prefix-descendant of POLYROOT (sentinel = dir holding rinoova-mcptool.code-workspace); else REFUSE
  if git-check-ignore(p) AND enclosing .git is a worktree FILE:
      p = main-worktree-realpath(p)   # gitignored-in-worktree → REDIRECT to canonical main checkout
                                       # (edit-time WARN `env-write-redirected-to-main` to ps — correct but surprising)
  return p                            # USED FOR BOTH lock-key AND scope resolution

scope(target):
  c = canonicalize(target); dir = c if isdir else dirname(c)
  walk up under POLYROOT: if .git(dir|file) → main-worktree-root; if code-workspace sentinel → POLYROOT
scope-key = scope path RELATIVE to POLYROOT; polyroot/cross-repo = reserved token "_root_" (never ".")
```

`scope()` walks up from the **edit target's realpath, not cwd** — a backend-cwd agent editing `deploy/.env-shared` resolves to `deploy` and shares the sidecar with a deploy-cwd agent. `doctor` nested-`.git` assert is STRUCTURAL: a `.git` FILE whose `gitdir:` resolves under an ancestor's `.git/worktrees/` is a benign pointer → SKIP; only a `.git` DIRECTORY or a submodule into `.git/modules/` is a scope-splitting violation; `.claude/worktrees/**` excluded.

---

## 11. Prioritized BUILD plan

**Phase 0 — eliminate before arbitrate (do now, near-zero):**
- `install --eliminate`: `git mv` the 5 loose polyroot `.md` docs into `rinoova-mcptool-architecture/docs/` and `release_all.sh` into `deploy/`. Untracked-loose Tier-1a set → ∅.
- `install`: write narrow gitignore + dockerignore FIRST; migrate the ≤5 legacy `{actor,event,file}` lines via the read-time adapter (no in-place rewrite of the live bus).

**Phase 1 — MVP (the kernel-hard core + discovery + gate). Honest estimate ~1–1.5 days.**
1. `env-set` + `env-write.mjs`: bare `flock(1)` + `O_NOFOLLOW` + atomic rename, VALUE on stdin, sorted acquisition order, self-watchdog. *(the only net-new authoritative mechanism)*
2. Tier-1a DENY: PreToolUse(Edit|Write|MultiEdit|NotebookEdit|MCP-fs) + PreToolUse(Bash) gating, fail-closed on unparseable redirection.
3. Bus reader/writer: leading-`\n` framing, schema-tolerant + content-hash dedup, 256 KiB tail-bound incremental fold, prototype-pollution-safe, Map/Object.create(null) keying.
4. GLOBAL lightweight announce/fold hook into `~/.claude`; `up` auto-extends per-project.
5. Per-session inotify coprocess: `fs.watch` re-fold + push + 5 s kernel-truth tick + `IN_Q_OVERFLOW` rescan + 5-min idle self-exit.
6. Launcher: `up` (mixed-mode worktree setup + preview + tmux new-window + label + parent-announce), `ps` (kernel-grounded views), `kill` (labeled-agent primary, kernel pgrp).
7. `install` (global + per-project) / `doctor` (slimmed 9-FAIL/WARN split, self-test worktree, Tier-1a derivation from compose `env_file:`).
8. `up --dry-run` preview (structural compose-membership convergence — the genuinely novel piece).
9. `watch --alarm` fallback for fully-unattended waves.

**Phase 2 — optional migrations (only on owner accept):**
- `install --sops`: SOPS for the 2 env files (encrypts *values*, preserves dotenv structure ⇒ concurrent different-key edits 3-way-merge cleanly ⇒ git becomes the env coordinator and **the entire §7 flock arbiter retires**). Ships its own key-distribution/decrypt-at-deploy/rotation runbook + a doctor round-trip-decrypt check. git-crypt explicitly rejected.

**Phase 3 — adopt at scale (do NOT build):**
- Route dashboard growth (`ps --follow` delta engine, board view, multi-wave status) to vibe-kanban/Conductor/claude-squad, injecting the hooks + preview as a collision plugin keyed on the checkout root.
- Optional Valkey accelerator via `docker exec rinoova-mcp-valkey valkey-cli publish/subscribe` when the stack is up — **zero authority**, the file bus stays the sole durable truth.

**Explicitly deferred (YAGNI):** `hold`/`resume`/`pause` (interim = SIGSTOP the labeled pgrp, documented); explicit `truncate`/`kill --group`; a delta engine beyond the coprocess re-fold; single-launch multi-scope waves (a cross-repo feature wave = N `up --scope` calls — defensible since different scopes don't collide).

---

## 12. Residual open problems (need resolution / acceptance before ship)

**Runtime-contract verifications (load-bearing, must be confirmed on the real Claude Code build before MVP ships):**
1. `flock(1)` fd-inheritance: confirm `/proc/locks` attributes the FLOCK to the surviving exec'd `node` for the command's full lifetime (no `-o/--close`), so `env-set` serialization is real.
2. PreToolUse can reliably **DENY** Bash and each fs-mutation tool, and the FULL set of mutation tool names in this harness is enumerated (an unhooked surface silently breaks the Tier-1a guarantee).
3. `file_path` in PreToolUse stdin is absolute (or relative-to-cwd, known) for scope resolution.
4. `fs.watch` maps to inotify `IN_MODIFY` on an O_APPEND-extended file and its behavior across the gc inode-swap (follows path vs old inode).
5. `PushNotification` is deliverable from a DETACHED coprocess.
6. Subagents fire SessionStart / inherit the global hook block — else parent-announce + `agents/<child-id>` + first-PreToolUse latch is load-bearing (the design hedges all three).

**Accepted residuals (disclosed, not closed — by design under §2):**
7. **Same-uid malicious availability** (flock parking, bus flood, `agents/` flood, hook/audit-log tamper) is human-kill-only. The 5 s kernel-truth tick + flood-bounded fold limit blast radius but do not prevent denial.
8. **Agent-to-agent reaction latency** = the peer's next tool boundary (cannot interrupt Claude mid-token). inotify gives the human/coprocess real-time visibility, not the incumbent agent a real-time reaction. Tier-0/1b same-file work is steered to worktrees so this window carries no data-loss risk — but the latency is real.
9. **Bus secret-containment is structurally incomplete:** anti-drift/audit skills append raw NL prose >120 chars, bypassing the write-gate. Mitigations (gitignore the bus, treat as untrusted prose) hold; a true fix needs porting those skills to a single agentsync writer API or splitting agentsync events to a separate file — out of MVP scope.
10. **Bash gating is best-effort:** fail-closed on unparseable redirection to a Tier-1a dir, but command substitution / `eval` / here-docs producing the path may force conservative DENYs or slip — not provable coverage.
11. **D-state Tier-1a holder** is genuinely unkillable while kernel I/O pends (ext4 fsync makes it ~ms-transient).
12. **Coprocess memory:** ~50 MB RSS/session (~0.8–1.4 GB across a 15–20 job wave); zero CPU but not zero memory; 5-min idle self-exit caps long-idle waves only.
13. **Tamper-evidence is weak:** doctor's hook hash-check and the kill/audit log are same-uid-writable. `chattr +a` + off-host sink is the upgrade — NOT in MVP.
14. **Collision FREQUENCY for the 2 env files is unestimated** (they don't exist yet, only `.example`). flock is justified by safety, not measured contention; cheap enough not to revisit, but the assumption is unverified.