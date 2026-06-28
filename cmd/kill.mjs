// kill — safe teardown of a launched agent: tmux window (primary) and/or recorded
// process group. Validates against the wave registry; never guesses a pid from the bus.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from '../lib/args.mjs'
import { realpathM, scopeRoot } from '../lib/scope.mjs'
import { loadConfig } from '../lib/config.mjs'
import { statePaths, listPresence, removePresence } from '../lib/coord.mjs'

export async function run(argv) {
  const a = parseArgs(argv, {})
  const label = a._[0]
  if (!label) throw new Error('usage: agentsync kill <label>')
  const scope = scopeRoot(realpathM(a.scope || process.cwd()))
  const cfg = loadConfig(scope)
  const wavePath = join(statePaths(scope, cfg).state, 'waves.json')
  const waves = existsSync(wavePath) ? JSON.parse(readFileSync(wavePath, 'utf8')) : {}
  const w = waves[label]
  let acted = false

  if (w?.window) {
    try { execFileSync('tmux', ['kill-window', '-t', w.window], { stdio: 'ignore' }); console.log(`✓ killed tmux window "${w.window}"`); acted = true }
    catch (e) { console.warn(`tmux kill-window failed: ${String(e.message).split('\n')[0]} (window may be gone)`) }
  }
  if (w?.pid) {
    try { process.kill(-w.pid, 'SIGTERM'); console.log(`✓ SIGTERM → process group ${w.pid}`); acted = true }
    catch { /* already gone */ }
  }
  // best-effort presence cleanup so it leaves `ps` immediately
  const p = listPresence(scope, cfg).find(x => x.label === label || x.id === label)
  if (p) removePresence(scope, cfg, p.id)
  if (w) { delete waves[label]; writeFileSync(wavePath, JSON.stringify(waves, null, 2)) }

  if (!acted) console.log(`no live window/pid recorded for "${label}" (already gone, or not launched via agentsync up)`)
}
