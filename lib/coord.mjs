// coord.mjs — high-level coordination ops shared by the hook and the CLI.
// Two stores per scope: the BUS (append-only event log, durable/replayable) and
// PRESENCE (state/agents/<id>, fast current-state, rebuildable from the bus).
// Awareness-mode identity = the harness session_id (stable across a session's
// hooks); liveness = heartbeat freshness (advisory) and/or a recorded pid.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, renameSync, rmSync, appendFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative } from 'node:path'
import { tesseraDir, busPath, enc, realpathM, enclosingGitRoot } from './scope.mjs'
import { Bus } from './bus.mjs'

export const HEARTBEAT_TTL_MS = 120_000
// Hard floor before a stale presence file is reaped (mirrors registry MAX_AGE_MS): a
// live-but-idle agent is never older than this, so the conservative reaper can't delete one.
export const PRESENCE_MAX_AGE_MS = 12 * 3600_000

export function statePaths(scope, cfg = {}) {
  const base = tesseraDir(scope, cfg)
  return { base, state: join(base, 'state'), agents: join(base, 'state', 'agents'), bus: busPath(scope, cfg) }
}

// A scope participates iff it has been opted in (.tessera/ exists), or the
// launcher set TESSERA_TOUCHES, or the user globally enabled TESSERA_AUTO=1.
// Otherwise the hook is a near-instant no-op (cheap in non-participating projects).
export function participates(scope, cfg = {}) {
  if (process.env.TESSERA_AUTO === '1') return true
  if ((process.env.TESSERA_TOUCHES || '').split(',').filter(Boolean).some(t => realpathM(t) === scope)) return true
  return existsSync(tesseraDir(scope, cfg))
}

// Create the scope's coordination dirs and (git-gated) ignore entries. Idempotent.
// opts.auto = the F safety net auto-opting this scope in: stay non-invasive — if the dir is
// ALREADY ignored (e.g. a global core.excludesFile lists .tessera/), do NOT write into the
// user's repo .gitignore. Explicit `install --scope` (opts.auto falsy) keeps writing it.
export function ensureScope(scope, cfg = {}, opts = {}) {
  const p = statePaths(scope, cfg)
  mkdirSync(p.agents, { recursive: true, mode: 0o700 })
  const gitRoot = enclosingGitRoot(scope)
  if (gitRoot && !(opts.auto && alreadyIgnored(scope, cfg))) {
    addIgnoreLine(join(gitRoot, '.gitignore'), relIgnore(gitRoot, scope, cfg))
    // .dockerignore only where a container build exists (gated, per final review)
    if (existsSync(join(gitRoot, 'Dockerfile')) || existsSync(join(gitRoot, 'compose.yaml')) ||
        existsSync(join(gitRoot, 'docker-compose.yml')) || existsSync(join(gitRoot, 'compose.yml'))) {
      addIgnoreLine(join(gitRoot, '.dockerignore'), relIgnore(gitRoot, scope, cfg))
    }
  }
  return p
}
// Is the coordination dir already git-ignored (by ANY source, incl. a global excludesFile)?
function alreadyIgnored(scope, cfg) {
  try { execFileSync('git', ['-C', scope, 'check-ignore', '-q', tesseraDir(scope, cfg)], { stdio: 'ignore' }); return true } catch { return false }
}
function relIgnore(gitRoot, scope, cfg) {
  const rel = relative(gitRoot, tesseraDir(scope, cfg)) || '.tessera'
  return rel + '/'
}
function addIgnoreLine(file, line) {
  try {
    let body = existsSync(file) ? readFileSync(file, 'utf8') : ''
    if (body.split('\n').some(l => l.trim() === line.trim())) return
    if (body && !body.endsWith('\n')) body += '\n'
    writeFileSync(file, body + line + '\n')
  } catch {}
}

const presFile = (scope, cfg, id) => join(statePaths(scope, cfg).agents, enc(id))

export function readPresence(scope, cfg, id) {
  try { return JSON.parse(readFileSync(presFile(scope, cfg, id), 'utf8')) } catch { return null }
}
export function writePresence(scope, cfg, id, patch) {
  ensureScope(scope, cfg)
  const cur = readPresence(scope, cfg, id) || { id, started: new Date().toISOString() }
  const next = { ...cur, ...patch, last_seen: new Date().toISOString() }
  const f = presFile(scope, cfg, id)
  const tmp = f + '.' + process.pid + '.tmp'
  writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 })
  renameSync(tmp, f)
  return next
}
export function removePresence(scope, cfg, id) { try { rmSync(presFile(scope, cfg, id)) } catch {} }

// Reads every per-agent presence file in the scope, tagging each with liveness (_live)
// and age (_ageMs). With opts.reap it ALSO best-effort deletes dead files, so the dir
// (and this O(files) read) self-heals instead of accumulating one ghost per unclean exit:
//   • default reap: CONSERVATIVE — only files dead well past any live window (age >
//     PRESENCE_MAX_AGE_MS, or a recorded pid that's gone and older than the TTL).
//   • opts.reapAll: AGGRESSIVE — any non-live file (offline `tessera gc` only; a stray
//     reap of an idle agent self-heals via the PreToolUse announce latch).
// The edit hot path (overlapWarning) calls this WITHOUT reap; only SessionStart / gc reap.
export function listPresence(scope, cfg, opts = {}) {
  const dir = statePaths(scope, cfg).agents
  if (!existsSync(dir)) return []
  const now = Date.now()
  const out = []
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.tmp')) continue
    let o
    try { o = JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch { continue }
    const ageMs = now - Date.parse(o.last_seen || o.started || 0)
    let live = ageMs < HEARTBEAT_TTL_MS
    if (o.pid != null) { live = existsSync(`/proc/${o.pid}`) } // recorded pid is stronger than heartbeat
    if (opts.reap) {
      const reapable = opts.reapAll
        ? !live
        : (ageMs > PRESENCE_MAX_AGE_MS) || (o.pid != null && !live && ageMs > HEARTBEAT_TTL_MS)
      if (reapable) { try { rmSync(join(dir, f)) } catch {} continue }
    }
    o._ageMs = ageMs; o._live = live
    out.push(o)
  }
  return out
}

export function bus(scope, cfg, id) { return new Bus(busPath(scope, cfg), id) }

// Announce presence + emit an announce event. Returns the digest of OTHER live peers.
export function announce(scope, cfg, id, info = {}) {
  ensureScope(scope, cfg)
  writePresence(scope, cfg, id, { role: info.role || 'agent', label: info.label, task: info.task, cwd: info.cwd, pid: info.pid })
  bus(scope, cfg, id).append('announce', { ref: info.cwd ? relpath(scope, info.cwd) : '.', msg: (info.label ? info.label + ' ' : '') + (info.task || '').slice(0, 100) })
  return peerDigest(scope, cfg, id)
}

export function heartbeat(scope, cfg, id, patch = {}) {
  if (!existsSync(presFile(scope, cfg, id))) return
  writePresence(scope, cfg, id, patch)
}

export function recordEdit(scope, cfg, id, target, tool) {
  const rel = relpath(scope, target)
  writePresence(scope, cfg, id, { last_ref: rel, last_tool: tool })
  bus(scope, cfg, id).append('edit', { ref: rel, msg: tool })
  return rel
}

export function done(scope, cfg, id) {
  bus(scope, cfg, id).append('done', {})
  removePresence(scope, cfg, id)
}

export function relpath(scope, target) {
  const r = relative(scope, realpathM(target))
  return r === '' ? '.' : r
}

// Short human/agent-facing digest of OTHER live peers in this scope and what they touch.
export function peerDigest(scope, cfg, selfId) {
  // SessionStart path: reap conservatively while we're already reading the dir (self-heals).
  const peers = listPresence(scope, cfg, { reap: true }).filter(p => p.id !== selfId && p._live)
  if (!peers.length) return ''
  const lines = peers.map(p => `  • ${p.label || p.id.slice(0, 12)}${p.task ? ' — ' + String(p.task).slice(0, 60) : ''}${p.last_ref ? ' [touching: ' + p.last_ref + ']' : ''}`)
  return `Tessera: ${peers.length} other agent(s) active in this scope (${scope}):\n${lines.join('\n')}\nCoordinate: avoid concurrently rewriting the same files; use \`tessera ps\` for live status.`
}

// Detect overlap: is any OTHER live peer touching the same path right now?
export function overlapWarning(scope, cfg, selfId, target) {
  const rel = relpath(scope, target)
  const clash = listPresence(scope, cfg).filter(p => p.id !== selfId && p._live && p.last_ref === rel)
  if (!clash.length) return null
  return `Tessera: ${clash.map(p => p.label || p.id.slice(0, 8)).join(', ')} is also touching ${rel}. Coordinate before overwriting.`
}
