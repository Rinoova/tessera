// registry.mjs — a tiny GLOBAL session registry used ONLY to detect, at SessionStart,
// whether ≥2 live agents share the same scope. That detection drives the "F" activation
// model: a not-yet-opted-in project gets AUTO-opted-in the moment a real collision
// becomes possible (see docs/ACTIVATION.md).
//
// Design constraints (deliberately lean):
//   • Lives in ~/.cache (XDG / ~/Library/Caches / %LOCALAPPDATA%) — NEVER inside a repo.
//   • Holds ONLY {sid, scope, ts, pid} — no file paths, no intents (those stay in the
//     per-scope bus). It is a ~liveness window, not a history of everywhere you worked.
//   • Liveness is pid-primary on POSIX (a session is live while its process runs), so a
//     long-running session stays detectable WITHOUT re-stamping on every edit — the edit
//     hot path is never touched. ts/TTL is the fallback (Windows / no pid).
//   • Self-GCs on every read (drops dead/expired records, compacts duplicates).
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const TTL_MS = 120_000              // heartbeat fallback liveness (== coord.HEARTBEAT_TTL_MS)
const MAX_AGE_MS = 12 * 3600_000    // hard cap: a "pid-alive" record older than this is pid reuse → drop

// Self-contained so this module does not depend on the (separately-phased) lib/os.mjs.
export function cacheDir() {
  let d
  if (process.platform === 'darwin') d = join(homedir(), 'Library', 'Caches', 'tessera')
  else if (process.platform === 'win32') d = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'tessera')
  else d = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'tessera')
  try { mkdirSync(d, { recursive: true, mode: 0o700 }) } catch {}
  return d
}
const sessFile = () => join(cacheDir(), 'sessions.ndjson')
const autoFile = () => join(cacheDir(), 'auto-scopes.ndjson')

function readNd(f) {
  try {
    return readFileSync(f, 'utf8').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}
const foldScope = (s) => process.platform === 'linux' ? s : String(s).toLowerCase()

function isLive(r, now) {
  if (now - (r.ts || 0) > MAX_AGE_MS) return false
  if (r.pid && process.platform !== 'win32') {
    try { process.kill(r.pid, 0); return true }            // process exists
    catch (e) { return e.code !== 'ESRCH' }                // ESRCH = dead; EPERM = alive-but-foreign
  }
  return now - (r.ts || 0) <= TTL_MS                        // no pid (Windows): TTL window
}

// Record our heartbeat. MUST be called BEFORE sessionPeers() so a concurrent peer can see us.
export function sessionTouch(sid, scope, pid) {
  if (!sid || !scope) return
  try { appendFileSync(sessFile(), JSON.stringify({ sid, scope, ts: Date.now(), pid: pid || process.pid }) + '\n', { mode: 0o600 }) } catch {}
}

// Live OTHER sessions sharing `scope`. Side effect: GC (drop dead/expired, keep latest per sid).
export function sessionPeers(scope, selfSid) {
  const now = Date.now()
  const recs = readNd(sessFile())
  if (!recs.length) return []
  const latest = new Map()
  for (const r of recs) { if (!r.sid) continue; const p = latest.get(r.sid); if (!p || (r.ts || 0) > (p.ts || 0)) latest.set(r.sid, r) }
  const live = []
  for (const r of latest.values()) if (isLive(r, now)) live.push(r)
  if (live.length !== recs.length) {                       // GC only when it changes something
    try { writeFileSync(sessFile(), live.map(r => JSON.stringify(r)).join('\n') + (live.length ? '\n' : ''), { mode: 0o600 }) } catch {}
  }
  const want = foldScope(scope)
  return live.filter(r => r.sid !== selfSid && foldScope(r.scope) === want)
}

// Single-undo inventory of scopes the safety net auto-created (for `tessera clean`).
export function recordAutoScope(scope) { try { appendFileSync(autoFile(), JSON.stringify({ scope, ts: Date.now() }) + '\n', { mode: 0o600 }) } catch {} }
export function listAutoScopes() { return [...new Set(readNd(autoFile()).map(r => r.scope).filter(Boolean))] }
export function clearAutoScopes() { try { writeFileSync(autoFile(), '') } catch {} }
