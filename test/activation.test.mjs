// activation.test.mjs — proves the F activation model: the global session registry
// (peer detection + pid-liveness GC), the cost-cliff invariant (the edit path never
// spins up coordination in a non-opted-in scope), and SessionStart auto-opt-in.
// Isolated via XDG_CACHE_HOME so it NEVER touches the real ~/.cache/tessera registry.
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dir = dirname(fileURLToPath(import.meta.url))
const HOOK = join(__dir, '..', 'hooks', 'tessera-hook.mjs')

// Isolate the registry BEFORE importing it (cacheDir reads XDG_CACHE_HOME at call time).
const CACHE = mkdtempSync(join(tmpdir(), 'tess-cache-'))
process.env.XDG_CACHE_HOME = CACHE
delete process.env.TESSERA_AUTO; delete process.env.TESSERA_TOUCHES; delete process.env.TESSERA_NUDGE
const { sessionTouch, sessionPeers } = await import('../lib/registry.mjs')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗ FAIL:', m) } }

// Fire the real node hook handler with a hook JSON on stdin in a given cwd.
function fire(event, { cwd, sid, tgt, tool, env = {} }) {
  const j = JSON.stringify({ hook_event_name: event, session_id: sid, cwd, tool_name: tool, tool_input: tgt ? { file_path: tgt } : undefined })
  try { execFileSync(process.execPath, [HOOK], { input: j, env: { ...process.env, XDG_CACHE_HOME: CACHE, ...env }, stdio: ['pipe', 'ignore', 'ignore'] }) } catch {}
}
const mkscope = (pfx) => { const d = mkdtempSync(join(tmpdir(), pfx)); mkdirSync(join(d, '.git')); return d }
const dirs = []

console.log('# registry: peer detection + pid-liveness GC')
const s1 = mkscope('tess-reg-'); dirs.push(s1)
sessionTouch('S1', s1, process.pid)                       // a live peer (test pid = alive)
ok(sessionPeers(s1, 'S2').length === 1, 'a live session is visible as a peer in its scope')
ok(sessionPeers(s1, 'S1').length === 0, 'a session does not see itself')
sessionTouch('DEAD', s1, 999999)                          // a dead pid
ok(!sessionPeers(s1, 'X').some(p => p.sid === 'DEAD'), 'a dead-pid session is GC-pruned')
const other = mkscope('tess-oth-'); dirs.push(other)
sessionTouch('S3', other, process.pid)
ok(sessionPeers(s1, 'Z').every(p => p.sid !== 'S3'), 'a live session in a DIFFERENT scope is not a peer (scope isolation)')

console.log('# cost-cliff: PreToolUse in a non-opted-in scope is a no-op (no .tessera)')
const solo = mkscope('tess-solo-'); dirs.push(solo)
fire('PreToolUse', { cwd: solo, sid: 'A', tgt: join(solo, 'x.js'), tool: 'Edit' })
ok(!existsSync(join(solo, '.tessera')), 'PreToolUse does NOT create .tessera in a non-participating scope (edit path stays free)')

console.log('# auto-opt-in: 2nd SessionStart with a live peer in scope enables coordination')
const shared = mkscope('tess-shr-'); dirs.push(shared)
sessionTouch('PEER', shared, process.pid)                 // pretend agent-1 is live here
fire('SessionStart', { cwd: shared, sid: 'AGENT2' })      // agent-2 starts → detects peer → auto-opt-in
ok(existsSync(join(shared, '.tessera')), 'SessionStart auto-creates .tessera when a live peer shares the scope')

console.log('# lone SessionStart does NOT auto-opt-in')
const lone = mkscope('tess-lone-'); dirs.push(lone)
fire('SessionStart', { cwd: lone, sid: 'SOLO' })
ok(!existsSync(join(lone, '.tessera')), 'SessionStart does NOT auto-opt-in when alone (no peer)')

console.log('# TESSERA_NUDGE=0 disables the safety net')
const off = mkscope('tess-off-'); dirs.push(off)
sessionTouch('PEER2', off, process.pid)
fire('SessionStart', { cwd: off, sid: 'AG', env: { TESSERA_NUDGE: '0' } })
ok(!existsSync(join(off, '.tessera')), 'with TESSERA_NUDGE=0 a detected peer does NOT auto-opt-in (pure opt-in)')

dirs.forEach(d => rmSync(d, { recursive: true, force: true }))
rmSync(CACHE, { recursive: true, force: true })
console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
