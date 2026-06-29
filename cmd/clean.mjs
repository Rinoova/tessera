// clean — undo every scope the F auto-opt-in safety net enabled (tracked in the global
// auto-scopes inventory). Removes each auto-created .tessera/ and the .tessera/ line it
// added to that repo's .gitignore. Explicitly opted-in scopes (`tessera install --scope`)
// are NOT in the inventory and are left untouched. See docs/ACTIVATION.md.
import { rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tesseraDir, enclosingGitRoot } from '../lib/scope.mjs'
import { loadConfig } from '../lib/config.mjs'
import { listAutoScopes, clearAutoScopes } from '../lib/registry.mjs'

export async function run() {
  const scopes = listAutoScopes()
  if (!scopes.length) { console.log('Nothing to clean — the safety net has not auto-enabled any scope.'); return }
  let removed = 0
  for (const scope of scopes) {
    const cfg = loadConfig(scope)
    const td = tesseraDir(scope, cfg)
    if (existsSync(td)) {
      try { rmSync(td, { recursive: true, force: true }); console.log(`  removed ${td}`); removed++ }
      catch (e) { console.log(`  ! could not remove ${td}: ${e.message}`) }
    }
    const gitRoot = enclosingGitRoot(scope)
    if (gitRoot) stripIgnoreLine(join(gitRoot, '.gitignore'), gitRoot, scope, cfg)
  }
  clearAutoScopes()
  console.log(`✓ cleaned ${removed} auto-enabled scope(s). Explicitly opted-in scopes are untouched.`)
}

function stripIgnoreLine(file, gitRoot, scope, cfg) {
  try {
    if (!existsSync(file)) return
    const want = ((relative(gitRoot, tesseraDir(scope, cfg)) || (cfg.dir || '.tessera')) + '/').trim()
    const lines = readFileSync(file, 'utf8').split('\n')
    const kept = lines.filter(l => l.trim() !== want)
    if (kept.length !== lines.length) writeFileSync(file, kept.join('\n'))
  } catch {}
}
