// ps — live agents per scope, what each touches, and overlaps. --follow = real-time
// (foreground fs.watch, zero idle daemon). --all scans for .agentsync scopes under cwd.
import { watch, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from '../lib/args.mjs'
import { realpathM, scopeRoot, agentsyncDir, busPath } from '../lib/scope.mjs'
import { loadConfig } from '../lib/config.mjs'
import { listPresence, statePaths } from '../lib/coord.mjs'

function renderScope(scope, cfg, problemsOnly) {
  let peers = listPresence(scope, cfg)
  const live = peers.filter(p => p._live)
  const byRef = {}
  for (const p of live) if (p.last_ref) (byRef[p.last_ref] ||= []).push(p)
  if (problemsOnly) peers = peers.filter(p => p.last_ref && byRef[p.last_ref]?.length > 1)
  let s = `▣ ${scope}  —  ${live.length} live / ${peers.length} known\n`
  if (!peers.length) return s + '   (no agents)\n'
  for (const p of peers) {
    const flag = p._live ? '●' : '○'
    const age = Math.round((p._ageMs || 0) / 1000)
    const overlap = (p.last_ref && byRef[p.last_ref]?.length > 1) ? '  ⚠ OVERLAP' : ''
    const name = (p.label || p.id).slice(0, 18).padEnd(18)
    s += `   ${flag} ${name} ${p._live ? 'live ' : `stale ${age}s`}  ${p.task ? '"' + String(p.task).slice(0, 38) + '"' : ''} ${p.last_ref ? '[' + p.last_ref + ']' : ''}${overlap}\n`
    s += `       ↳ agentsync kill ${p.label || p.id}\n`
  }
  return s
}

function findScopes(root) {
  const out = []
  const walk = (dir, depth) => {
    if (depth > 4) return
    let ents
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
    if (ents.some(e => e.isDirectory() && e.name === '.agentsync')) out.push(dir)
    for (const e of ents) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue
      walk(join(dir, e.name), depth + 1)
    }
  }
  walk(root, 0)
  return out
}

export async function run(argv) {
  const a = parseArgs(argv, { booleans: ['follow', 'all', 'problems'] })
  const root = realpathM(a.scope || process.cwd())
  const scopes = a.all ? findScopes(root) : [scopeRoot(root)]
  const draw = () => {
    if (a.follow) process.stdout.write('\x1b[2J\x1b[H')
    let out = ''
    for (const sc of scopes) out += renderScope(sc, loadConfig(sc), a.problems)
    process.stdout.write(out + (a.follow ? `\n(live — Ctrl-C to exit; refreshes on change)\n` : ''))
  }
  draw()
  if (a.follow) {
    for (const sc of scopes) {
      const cfg = loadConfig(sc)
      try { watch(statePaths(sc, cfg).agents, () => draw()) } catch {}
      try { if (existsSync(busPath(sc, cfg))) watch(busPath(sc, cfg), () => draw()) } catch {}
    }
    setInterval(draw, 5000) // kernel-truth tick: catches stale (no file event) agents
    await new Promise(() => {})
  }
}
