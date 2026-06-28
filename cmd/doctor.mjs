// doctor — lean health check: ignore-confirmed (git-gated), hooks installed,
// platform/fs sane. FAIL blocks coordination guarantees; WARN proceeds.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'
import { parseArgs } from '../lib/args.mjs'
import { realpathM, scopeRoot, tesseraDir, enclosingGitRoot, busPath } from '../lib/scope.mjs'
import { loadConfig } from '../lib/config.mjs'

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

  existsSync(tesseraDir(scope, cfg)) ? ok('.tessera present (scope opted-in)') : wf('.tessera absent — run: tessera install --scope .')

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

  console.log(`\n${fail ? `FAIL (${fail} blocking, ${warn} warn)` : warn ? `OK with ${warn} warning(s)` : 'OK — all green'}`)
  process.exit(fail ? 1 : 0)
}
