#!/usr/bin/env node
// tessera — portable coordination for concurrent local Claude Code agents.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const SRC = dirname(dirname(fileURLToPath(import.meta.url)))
export const HOOK = join(SRC, 'hooks', 'tessera-hook.mjs')

const HELP = `tessera — coordinate concurrent local Claude Code agents (per-scope, real-time, low-level)

USAGE
  tessera install [--global] [--scope DIR] [--auto] [--uninstall]
      --global    merge the coordination hooks into ~/.claude/settings.json (fires in EVERY project)
      --scope DIR opt a project IN (create its .tessera/ + gitignore). Default scope = cwd's project.
      --auto      set TESSERA_AUTO=1 guidance (participate in every project without per-scope opt-in)
      --uninstall remove tessera hooks from ~/.claude/settings.json

  tessera up --task "..." [--scope DIR] [-n K] [--shared|--isolated] [--label NAME]
               [--touches A,B] [--dry-run] [--print] [--cmd 'CMD']
      Launch K coordinated agents. DEFAULT --shared (one checkout, awareness bus + overlap warnings).
      --isolated gives each agent a git worktree+branch (git merge is the conflict gate; needs git).
      --dry-run  show predicted collisions and exit. --print uses 'claude -p'. --cmd overrides the spawn.

  tessera ps [--scope DIR] [--all] [--follow] [--problems]
      Live agents per scope (kernel/heartbeat-verified), what each is touching, overlaps. --follow = real-time.

  tessera kill <label>            Safe teardown of a launched agent (tmux window / process group).
  tessera doctor [--scope DIR] [--all]   Health check (ignore-confirmed, hooks installed, platform).

Scope = nearest project root (markers: .tessera-scope, .git, package.json, go.mod, pyproject.toml, ...).
Two agents coordinate only where their paths overlap; different projects stay mutually invisible.`

const cmd = process.argv[2]
const rest = process.argv.slice(3)
const KNOWN = new Set(['install', 'up', 'ps', 'kill', 'doctor', 'put'])

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); process.exit(0) }
if (!KNOWN.has(cmd)) { console.error(`unknown command: ${cmd}\n`); console.log(HELP); process.exit(1) }

try {
  const mod = await import(join(SRC, 'cmd', `${cmd}.mjs`))
  await mod.run(rest, { SRC, HOOK })
} catch (e) {
  console.error(`tessera ${cmd}: ${e.message}`)
  process.exit(1)
}
