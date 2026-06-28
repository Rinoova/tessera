// install — merge the coordination hooks into ~/.claude/settings.json (global, fires
// in every project), drop the skill, and optionally opt a project in. Idempotent.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir, platform } from 'node:os'
import { parseArgs } from '../lib/args.mjs'
import { realpathM, scopeRoot, enclosingGitRoot } from '../lib/scope.mjs'
import { loadConfig } from '../lib/config.mjs'
import { ensureScope } from '../lib/coord.mjs'

const HOOK_EVENTS = {
  SessionStart: null,
  PreToolUse: 'Edit|Write|MultiEdit|NotebookEdit',
  Stop: null,
  SubagentStop: null,
  SessionEnd: null,
}

function isOurs(entry) {
  return entry?.hooks?.some(h => typeof h.command === 'string' && h.command.includes('tessera-hook') || h.command.includes('agentsync-hook'))
}

export async function run(argv, { HOOK }) {
  const a = parseArgs(argv, { booleans: ['global', 'auto', 'uninstall'] })
  const settingsPath = join(homedir(), '.claude', 'settings.json')
  const wrapper = join(dirname(HOOK), 'tessera-hook.sh') // sh fast-filter → exec node handler
  const command = `sh ${wrapper}`

  if (platform() !== 'linux') {
    console.warn('⚠ Tessera awareness mode is cross-platform, but kernel features (flock holders, /proc liveness, pgrp kill) are Linux-only. Proceeding with awareness mode.')
  }

  // Per-scope opt-in
  if (a.scope || (!a.global && !a.uninstall)) {
    const scope = scopeRoot(realpathM(a.scope || process.cwd()))
    const cfg = loadConfig(scope)
    ensureScope(scope, cfg)
    const git = enclosingGitRoot(scope)
    console.log(`✓ opted-in scope: ${scope}`)
    console.log(`  created ${scope}/.tessera/  ${git ? '(+ .gitignore entry)' : '(no git — relying on 0700 + reserved dir name)'}`)
  }

  if (a.global || a.uninstall) {
    mkdirSync(join(homedir(), '.claude'), { recursive: true })
    if (existsSync(settingsPath)) { // back up before touching the user's global settings
      const bak = settingsPath + '.tessera-bak'
      if (!existsSync(bak)) { copyFileSync(settingsPath, bak); console.log(`  (backed up settings → ${bak})`) }
    }
    const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {}
    settings.hooks ||= {}
    // Always strip our prior entries first (idempotent / uninstall)
    for (const ev of Object.keys(HOOK_EVENTS)) {
      if (Array.isArray(settings.hooks[ev])) {
        settings.hooks[ev] = settings.hooks[ev].filter(e => !isOurs(e))
        if (!settings.hooks[ev].length) delete settings.hooks[ev]
      }
    }
    if (!a.uninstall) {
      for (const [ev, matcher] of Object.entries(HOOK_EVENTS)) {
        settings.hooks[ev] ||= []
        const entry = { hooks: [{ type: 'command', command }] }
        if (matcher) entry.matcher = matcher
        settings.hooks[ev].push(entry)
      }
    }
    if (a.auto) { settings.env ||= {}; settings.env.TESSERA_AUTO = '1' }
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
    console.log(a.uninstall
      ? `✓ removed Tessera hooks from ${settingsPath}`
      : `✓ installed Tessera hooks (SessionStart, PreToolUse[${HOOK_EVENTS.PreToolUse}], Stop, SubagentStop, SessionEnd) into ${settingsPath}`)
    if (!a.uninstall) installSkill()
  }

  if (!a.global && !a.uninstall && !a.scope && process.cwd()) {
    console.log('\nNext: `tessera install --global` to wire hooks everywhere, then `tessera up --task "..." -n 3`.')
  }
}

function installSkill() {
  try {
    const src = join(realpathM(join(import.meta.dirname || '.', '..')), 'skill')
    const dst = join(homedir(), '.claude', 'skills', 'tessera')
    if (!existsSync(src)) return
    mkdirSync(dst, { recursive: true })
    for (const f of readdirSync(src)) copyFileSync(join(src, f), join(dst, f))
    console.log(`✓ installed skill → ${dst}`)
  } catch (e) { /* skill is optional */ }
}
