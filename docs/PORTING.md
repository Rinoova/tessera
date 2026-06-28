# Tessera — native porting design (macOS next · Windows 11 TBD)

How to make Tessera run **natively** on macOS and Windows 11 — **no WSL, no Cygwin, no Git Bash requirement** — while keeping it zero-dependency and lean. Staged: **macOS is near-term and low-effort; Windows is the larger, to-be-determined work** that needs verification on real hardware.

> Derived from deep research (Claude Code hook execution per OS, NTFS append semantics, `fs.watch` backends, cross-platform liveness) + six adversarial design rounds. Sources and the full round history are summarized at the end.

---

## The key insight: awareness is already mostly OS-neutral

Awareness mode keys each agent on the **harness `session_id` + a heartbeat TTL**, *not* on a kernel pid. So `/proc` is only used for an optional pid-liveness check and for the (deferred) flock tier. Everything load-bearing for awareness — the append-only NDJSON bus, the schema-tolerant reader, scope detection, the hook handler — is **byte-identical across all three OS**. The port collapses into **one small abstraction file, `lib/os.mjs`**, plus an OS-aware installer. We do *not* fork the codebase.

### Shared vs branched

| Area | Status |
|---|---|
| `bus.mjs`, `identity.mjs`, `scope.mjs`, `config.mjs`, `args.mjs`, `bin/`, the hook handler, the bus reader | **Shared, byte-identical** |
| `install.mjs`, `coord.mjs`, `doctor.mjs` | **Branched** through `lib/os.mjs` |
| `up.mjs`, `kill.mjs` (the launcher) | **POSIX-only in MVP** — refuse off-POSIX with a clear "capability gap" message |
| flock tier, `/proc` pid-liveness, Windows launcher/teardown | **Deferred on all OS** |

### `lib/os.mjs` — the one abstraction (builtins only, zero deps)

```
platform()              → process.platform
foldPath(p)             → case-fold equality key (macOS + Windows are case-insensitive)
atomicRename(tmp,dst)   → rename, with a Windows AV/indexer retry loop
cacheDir()              → OS-local state dir (backup + a Windows per-scope manifest)
hookInstallEntry()      → the platform-correct settings.json hook entry
isNetworkFs(dir)        → network-filesystem detector for a loud doctor warning
assertPosixOnly(feat)   → shared refusal used by up/kill (not a branch)
```

Two corrections the review surfaced that matter even before Windows:

- **Case-insensitive paths.** macOS (APFS, default) and Windows (NTFS) are case-insensitive. Overlap detection (`last_ref` comparison), scope resolution, and `.tessera/` discovery must compare via `foldPath` (resolve real case when the path exists; fall back to `NFC + toLowerCase` for not-yet-existing targets). On Linux `foldPath` is the identity function.
- **Watch the bus's *parent directory*, not the file.** `fs.watch` on a single, never-renamed, in-place-appended file does **not** reliably deliver events on macOS (FSEvents is directory-granular) or Windows (ReadDirectoryChangesW coalesces). Watching the parent dir surfaces appends as directory events. The 5-second reconcile tick remains the real correctness floor everywhere; the doorbell is only a hint.

---

## macOS (next — low effort)

macOS is "essentially free": Claude Code runs hook commands through **`sh -c`, exactly like Linux**, and `tmux`, `git`, POSIX signals and process groups are all present. The delta is small:

- **Hook install:** identical to Linux — the `sh` fast-filter wrapper and the hook command work unchanged (the ~1 ms no-op fast-path is preserved on macOS).
- **`lib/os.mjs` macOS bits:** `foldPath` (APFS case-fold), `cacheDir()` → `~/Library/Caches/tessera`, `isNetworkFs()` by parsing `/sbin/mount` (type ∈ `smbfs,nfs,afpfs,webdav,ftp`; never GNU `stat -c`, which is a no-op on BSD; never `stat -f '%T'`, which returns a file-type glyph, not the fs type).
- **Liveness:** awareness uses heartbeat TTL; the optional pid check swaps `existsSync('/proc/pid')` → stays Linux-gated (the pid tier is deferred), so macOS needs nothing here for MVP.
- **`fs.watch`:** apply the watch-parent-dir fix (benefits Linux too).
- **Launcher:** `up`/`ps`/`kill` work as-is (POSIX). `tmux` present.

**What ships on macOS:** the full thing — awareness coordination **and** the launcher. The only genuinely macOS-specific risks to verify on real hardware are the `/sbin/mount` network-fs classification and FSEvents doorbell latency (both have the 5 s tick as a floor).

---

## Windows 11 (TBD — the larger work)

Windows has no `sh`, no `/proc`, no POSIX signals/process-groups, and a case-insensitive FS with `\` separators. The plan ships **awareness-only first** (hooks + bus + `ps` monitor); the launcher (`up`/`kill`) is deferred and refuses with a clear message.

- **Hook execution (the keystone).** Claude Code routes shell-form hook commands to **Git Bash, or PowerShell when Git Bash is absent — never `cmd.exe`** — so a `.sh` wrapper is fragile. The fix is to run **`node` directly**: install a node-direct hook entry using **forward-slash absolute paths** (`"C:/.../node.exe" "C:/Users/<you>/.claude/tessera/tessera-hook.mjs"`), which is robust across the shells Claude may route to; the documented alternative is the **exec form** (`{"command":"node","args":[hookPath]}`), which spawns the binary with no shell at all. The `.sh` fast pre-filter cannot run on Windows, so the participation check is baked into the **top of the node hook itself** (a synchronous walk-up for `.tessera/`); Windows therefore pays a node cold-start (~40–80 ms, more under a first Defender scan) per tool call in *participating* repos. Non-participating repos opt in per-scope via `.claude/settings.local.json`, keeping unrelated repos at zero cost.
- **Append atomicity — no lock needed.** Node/libuv opens `'a'` with `FILE_APPEND_DATA` (and `FILE_SHARE_READ|WRITE|DELETE`), so each single `WriteFile` of a ≤16 KB record is a **kernel-atomic EOF extension** — the well-known MSVCRT non-atomicity does *not* apply. **Invariant:** the bus fd must stay `O_APPEND`-only; any positioned/`r+` write silently destroys atomic append. The only Windows addition is an **open-retry with jittered backoff** (Defender real-time / Search-Indexer can briefly hold the file) and a persisted **loss counter** that `doctor` surfaces — so a drop is observable, never invisible. *This must be confirmed by a multi-process NTFS torture test before Windows ships.*
- **`atomicRename`** (presence writes) gets the same AV/indexer retry loop.
- **`lib/os.mjs` Windows bits:** `foldPath` via `realpathSync.native` (handling the `\\?\` prefix and drive-letter casing), `cacheDir()` → `%LOCALAPPDATA%\tessera`, `isNetworkFs()` via UNC-prefix + `fsutil fsinfo drivetype`.
- **Deferred on Windows:** the launcher. `wt.exe` (Windows Terminal) can *open and arrange* named tabs in one call but has **no CLI to close** a tab/pane, and there are no signals/process-groups — teardown would need `taskkill /T /F` on a recorded pid plus a pid-creation-time guard (no `StartTime` without a native addon → would break zero-dep). So Windows gets awareness first; the launcher comes with the pid tier.

---

## What stays deferred on every OS

- **The flock writer tier** (opt-in, for genuinely-shared non-mergeable files). When it ships it brings the per-OS pieces with it: a portable advisory lock (a `mkdir`-based lock — atomic on every FS, zero-dep — rather than the Linux-only `flock(1)`), and a pid start-time source per OS (`/proc` · `ps -o lstart` · `Win32_Process.CreationDate`).
- **The pid-liveness tier** (kernel-pid identity + reaping). MVP liveness is the heartbeat TTL on all OS.

---

## Build order

1. **OS-neutral correctness** (lands on Linux too, no platform risk): Buffer-encode the bus append with a bounded re-emit loop, an errno-keyed open-retry with a non-spinning `Atomics.wait` backoff, and a `recordBusLoss()` counter; off-Linux `bootId()` fallback; OS-aware self-test; separator-normalized `.gitignore` writing; the watch-parent-dir fix.
2. **`lib/os.mjs`** (the 6 members + `assertPosixOnly`); wire `foldPath` into participation/overlap/`ps`.
3. **Install surface** (the load-bearing port): render hook files into `~/.claude/tessera/`; POSIX home-relative `sh` wrapper vs Windows node-direct entry; shape-based idempotent `isOurs`; per-scope `settings.local.json` default + a `cacheDir()` manifest; clean cross-OS uninstall.
4. **Observability:** `doctor` network-fs warning + node-floor check + bus-loss warning; `ps` parent-dir watch + re-arm + error-degrade.
5. **Ship gates (real hardware):** the empirical tests below. Windows ships only after they pass.

---

## Empirical tests (the ship gates)

These need a **real machine** — they're why Windows is TBD:

**Windows 11 (live Claude session):**
- Confirm Claude's hook executor actually runs the node-direct (forward-slash / exec-form) command — that an announce and a bus record land.
- Multi-process **NTFS concurrent-append torture test** (N processes × M framed records): assert zero byte-interleave, every record starts with a leading `\n`, zero loss.
- Reproduce a Defender full-scan / indexer window holding the bus and verify the backoff + loss-counter behavior; measure cold-vs-warm hook latency.
- `foldPath` makes `src\Foo.txt`, `src/Foo.txt`, `src/foo.txt` fold-equal (including not-yet-existing targets).
- Confirm PreToolUse hooks are honored from project `.claude/settings.local.json` (gates the per-scope strategy); upgrade/uninstall idempotency.

**macOS (live Claude session):**
- Confirm hook commands run through a `$HOME`-expanding shell (so the home-relative wrapper resolves).
- `/sbin/mount` parsing classifies local APFS as local and a real SMB/NFS mount (inside *and* outside `/Volumes`) as network.
- `fs.watch` on the bus parent dir repaints `ps --follow` promptly enough.

---

## Honest residuals

- **Real-time awareness on each new OS is unproven until the live-session test passes** — it hinges on Claude's native hook executor running the node-direct form.
- **A shared bus on a network mount (SMB/NFS/UNC)** is best-effort interleave on *all three* OS with no MVP lock; mitigations are the loud `doctor` warning and co-locating the bus on a local disk (`cfg.bus_path`). The opt-in lock tier closes this later.
- **Brand-new non-ASCII filenames** fold via `NFC + toLowerCase`, not the exact OS case-fold table — a documented best-effort edge on macOS and Windows.
- **No hard `TESSERA_GUARD` reaping off-Linux** in MVP: external termination leaves at most a TTL-bounded phantom that can only warn, until the pid tier lands.

The throughline: macOS is a small, near-term delta that ships the whole tool; Windows is real work whose correctness must be *proven on hardware*, so it's deliberately staged behind macOS.
