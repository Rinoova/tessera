// doctor — lean health check: ignore-confirmed (git-gated), hooks installed,
// platform/fs sane. FAIL blocks coordination guarantees; WARN proceeds.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'
import { parseArgs } from '../lib/args.mjs'
import { realpathM, scopeRoot, tesseraDir, enclosingGitRoot, busPath } from '../lib/scope.mjs'
import { loadConfig } from '../lib/config.mjs'
import { sessionPeers } from '../lib/registry.mjs'

export async function run(argv) {
  const a = parseArgs(argv, { booleans: ['all'] })
  const scope = scopeRoot(realpathM(a.scope || process.cwd()))
  const cfg = loadConfig(scope)
  let fail = 0, warn = 0
  const ok = (m) => console.log('  ✓', m)
  const wf = (m) => { warn++; console.log('  ⚠', m) }
  const ff = (m) => { fail++; console.log('  ✗', m) }

  console.log(`Tessera doctor — scope ${scope}`)
  platform() === 'linux' ? ok('platform linux (full features)') : wf(`platform ${platform()} — awareness only; kernel features (flock holders, /proc, pgrp kill) are Linux-only`)

  const optedIn = existsSync(tesseraDir(scope, cfg))
  optedIn ? ok('.tessera present (scope opted-in)') : wf('.tessera absent — run: tessera install --scope . (or let the safety net auto-enable on a collision)')

  // F activation model: is the auto-opt-in safety net armed, and are other live agents here?
  const nudge = process.env.TESSERA_NUDGE !== '0'
  nudge ? ok('auto-opt-in safety net armed (TESSERA_NUDGE; set =0 for pure opt-in)') : wf('auto-opt-in safety net OFF (TESSERA_NUDGE=0) — only explicit opt-in coordinates')
  let peers = []
  try { peers = sessionPeers(scope, '__doctor__') } catch {}
  if (peers.length) wf(`${peers.length} other live agent(s) registered in this scope — ${optedIn ? 'coordination active' : 'would auto-enable on the next agent\'s SessionStart'}`)
  else ok('no other live agents registered in this scope (solo)')

  const git = enclosingGitRoot(scope)
  if (git) {
    try { execFileSync('git', ['-C', scope, 'check-ignore', '-q', busPath(scope, cfg)], { stdio: 'ignore' }); ok('coordination bus is git-ignored') }
    catch { wf('bus NOT git-ignored — run `tessera install --scope .` to add the .gitignore line') }
  } else ok('no enclosing git repo (ignore N/A; 0700 + reserved dir name protect it)')

  const sp = join(homedir(), '.claude', 'settings.json')
  let hooked = false
  try { hooked = readFileSync(sp, 'utf8').includes('tessera-hook') } catch {}
  hooked ? ok('global hooks installed in ~/.claude/settings.json') : ff('hooks NOT installed — run `tessera install --global`')

  try {
    const fst = execFileSync('stat', ['-f', '-c', '%T', tesseraDir(scope, cfg)], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const isNet = /nfs|cifs|smb|9p/i.test(fst)
    isNet ? wf(`coordination dir on ${fst} — flock & inotify are unreliable on network filesystems`) : ok(`coordination dir on local fs (${fst})`)
  } catch {}

  try {
    const sz = statSync(busPath(scope, cfg)).size
    sz > 5 * 1024 * 1024 ? wf(`bus.ndjson is ${(sz / 1048576).toFixed(1)} MB — run \`tessera gc\` to compact it`) : ok(`bus.ndjson size OK (${(sz / 1024).toFixed(0)} KB)`)
  } catch {}

  console.log(`\n${fail ? `FAIL (${fail} blocking, ${warn} warn)` : warn ? `OK with ${warn} warning(s)` : 'OK — all green'}`)
  process.exit(fail ? 1 : 0)
}
