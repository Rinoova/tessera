// up — launch K coordinated agents. DEFAULT --shared (one checkout: awareness bus +
// overlap warnings, matching "agents collaborate on the same folders"). --isolated
// gives each a git worktree+branch (git merge is the conflict gate). Previews collisions.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from '../lib/args.mjs'
import { realpathM, scopeRoot } from '../lib/scope.mjs'
import { loadConfig } from '../lib/config.mjs'
import { ensureScope, statePaths, listPresence } from '../lib/coord.mjs'

const shq = (s) => `'` + String(s).replace(/'/g, `'\\''`) + `'`
const have = (bin) => { try { execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' }); return true } catch { return false } }
const isGit = (dir) => { try { return execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() === 'true' } catch { return false } }

export async function run(argv) {
  const a = parseArgs(argv, { booleans: ['shared', 'isolated', 'dry-run', 'print', 'yes'], aliases: { n: 'n' } })
  const task = typeof a.task === 'string' ? a.task : ''
  if (!task) throw new Error('--task "..." is required')
  const scope = scopeRoot(realpathM(a.scope || process.cwd()))
  const cfg = loadConfig(scope)
  ensureScope(scope, cfg)
  const n = Math.max(1, parseInt(a.n || '1', 10))
  const git = isGit(scope)
  let mode = a.isolated ? 'isolated' : 'shared'
  if (mode === 'isolated' && !git) { console.warn('⚠ --isolated needs git; scope is not a git work tree → degrading to --shared.'); mode = 'shared' }

  const wavePath = join(statePaths(scope, cfg).state, 'waves.json')
  const waves = existsSync(wavePath) ? JSON.parse(readFileSync(wavePath, 'utf8')) : {}
  const waveN = (waves.__n || 0) + 1
  const labelBase = a.label || `wave${waveN}`
  const touches = a.touches || scope

  // ---- preview (always runs; --dry-run stops here) ----
  const peers = listPresence(scope, cfg).filter(p => p._live)
  console.log(`AgentSync up — scope=${scope}`)
  console.log(`  mode=${mode} ${mode === 'shared' ? '(one checkout: awareness bus + overlap warnings)' : '(git worktree+branch per agent: git merge is the conflict gate)'}`)
  console.log(`  launching ${n} agent(s) [${labelBase}.1..${n}]  task="${task.slice(0, 70)}"`)
  if (peers.length) console.log(`  ⚠ already live here: ${peers.map(p => p.label || p.id.slice(0, 8)).join(', ')} — new agents will share this scope`)
  if (mode === 'shared' && n > 1) console.log(`  ⓘ ${n} agents share ONE checkout; they self-discover & get overlap warnings. Use --isolated for hard git isolation.`)
  if (a['dry-run']) { console.log('  --dry-run: not launching.'); return }

  const tmux = have('tmux')
  const SESSION = 'agentsync'
  if (tmux) { try { execFileSync('sh', ['-c', `tmux has-session -t ${SESSION} 2>/dev/null || tmux new-session -d -s ${SESSION} -n _home`], { stdio: 'ignore' }) } catch {} }
  else console.warn('  ⚠ tmux not found — spawning detached (setsid). Use `agentsync ps` to monitor.')
  const launched = []
  for (let i = 1; i <= n; i++) {
    const label = `${labelBase}.${i}`
    let cwd = scope
    if (mode === 'isolated') {
      const wt = join(scope, '.claude', 'worktrees', label)
      try { execFileSync('git', ['-C', scope, 'worktree', 'add', '-b', `agentsync/${label}`, wt], { stdio: 'ignore' }); cwd = wt }
      catch (e) { console.warn(`  ⚠ worktree add failed for ${label} (${String(e.message).split('\n')[0]}) → shared checkout`) }
    }
    const agentCmd = a.cmd ? String(a.cmd) : (a.print ? `claude -p ${shq(task)}` : `claude ${shq(task)}`)
    const windowCmd = `cd ${shq(cwd)} && export AGENTSYNC_LABEL=${shq(label)} AGENTSYNC_TASK=${shq(task)} AGENTSYNC_TOUCHES=${shq(touches)} AGENTSYNC_ROLE=agent && ${agentCmd}`
    if (tmux) {
      const wid = execFileSync('tmux', ['new-window', '-d', '-P', '-F', '#{window_id}', '-t', SESSION, '-n', label, windowCmd], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      waves[label] = { window: wid, started: new Date().toISOString(), task, mode, cwd, cmd: agentCmd }
    } else {
      const child = spawn('setsid', ['sh', '-c', windowCmd], { detached: true, stdio: 'ignore' })
      child.unref()
      waves[label] = { pid: child.pid, started: new Date().toISOString(), task, mode, cwd, cmd: agentCmd }
    }
    launched.push(label)
    console.log(`  ▸ ${label}  ${mode === 'isolated' ? '(worktree ' + cwd.replace(scope, '.') + ')' : ''}`)
  }
  waves.__n = waveN
  writeFileSync(wavePath, JSON.stringify(waves, null, 2))
  console.log(`✓ launched ${launched.length} agent(s). Monitor: agentsync ps --follow   Teardown: agentsync kill <label>`)
}
