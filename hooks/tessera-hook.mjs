// tessera-hook.mjs — the single Claude Code hook handler.
// Reads hook JSON on stdin, dispatches on hook_event_name. Awareness mode:
// announces presence, records what each agent touches, surfaces live peers.
// FAIL-OPEN: any internal error exits 0 silently so coordination never blocks an agent.
import { readFileSync, statSync } from 'node:fs'
import { scopeRoot, busPath } from '../lib/scope.mjs'
import { loadConfig } from '../lib/config.mjs'
import {
  participates, announce, heartbeat, recordEdit, done, overlapWarning, readPresence, ensureScope,
} from '../lib/coord.mjs'
import { sessionTouch, sessionPeers, recordAutoScope } from '../lib/registry.mjs'

function readStdin() {
  try { return JSON.parse(readFileSync(0, 'utf8')) } catch { return {} }
}
function out(obj) { process.stdout.write(JSON.stringify(obj)); process.exit(0) }
function pass() { process.exit(0) }

const MUTATORS = /^(Edit|Write|MultiEdit|NotebookEdit)$|^mcp__.*(write|edit|create|put|save)/i
const BUS_WARN_BYTES = 5 * 1024 * 1024   // SessionStart nudges to run `tessera gc` past this

function targetPath(j) {
  const ti = j.tool_input || {}
  return ti.file_path || ti.path || ti.notebook_path || null
}

try {
  const j = readStdin()
  const ev = j.hook_event_name || j.hookEventName
  const id = j.session_id || j.sessionId || `nosid:${j.cwd || process.cwd()}`
  const cwd = j.cwd || process.cwd()
  const label = process.env.TESSERA_LABEL || null
  const task = process.env.TESSERA_TASK || null

  if (ev === 'SessionStart') {
    const scope = scopeRoot(cwd)
    const cfg = loadConfig(scope)
    let autoNote = ''
    // F safety net (TESSERA_NUDGE!=0): register in the global session registry; if another
    // LIVE agent already shares this scope but it isn't opted-in, AUTO-opt-in this one repo
    // so the collision that's now possible is actually coordinated. Best-effort: any failure
    // degrades to plain opt-in (silent, safe). See docs/ACTIVATION.md.
    if (process.env.TESSERA_NUDGE !== '0') {
      sessionTouch(id, scope, process.pid)
      // sessionPeers() compacts the global registry as a side effect. Call it UNCONDITIONALLY
      // (not gated behind !participates) so the GC fires on every SessionStart — otherwise an
      // opted-in scope's agents never trigger it and sessions.ndjson grows without bound.
      const peers = sessionPeers(scope, id)
      if (!participates(scope, cfg) && peers.length >= 1) {
        try {
          ensureScope(scope, cfg, { auto: true })
          recordAutoScope(scope)
          autoNote = `\nTessera: another live agent is working in this project — coordination AUTO-ENABLED here (.tessera/). Keep it: \`tessera install --scope .\`  ·  undo: \`tessera clean\`.`
        } catch {}
      }
    }
    if (!participates(scope, cfg)) pass()
    const digest = announce(scope, cfg, id, { cwd, label, task, role: process.env.TESSERA_ROLE || 'agent' })
    let busNote = ''
    try { const sz = statSync(busPath(scope, cfg)).size; if (sz > BUS_WARN_BYTES) busNote = `\nTessera: bus.ndjson is ${(sz / 1048576).toFixed(1)} MB — run \`tessera gc\` to compact it.` } catch {}
    const msg = (digest || '') + autoNote + busNote
    if (msg) out({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: msg } })
    pass()
  }

  if (ev === 'PreToolUse') {
    const tool = j.tool_name || j.toolName || ''
    if (!MUTATORS.test(tool)) pass()
    const tgt = targetPath(j)
    if (!tgt) pass()
    const scope = scopeRoot(tgt)
    const cfg = loadConfig(scope)
    if (!participates(scope, cfg)) pass()
    // first-PreToolUse latch: announce ONCE (covers subagents, which don't fire
    // SessionStart, and any session not yet announced). recordEdit heartbeats after.
    if (!readPresence(scope, cfg, id)) announce(scope, cfg, id, { cwd, label, task })
    recordEdit(scope, cfg, id, tgt, tool)
    const warn = overlapWarning(scope, cfg, id, tgt)
    if (warn && process.env.TESSERA_GUARD === '1') {
      out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: warn + ' (TESSERA_GUARD active) — wait or pick a different file.' } })
    }
    if (warn) out({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: warn } })
    pass()
  }

  if (ev === 'Stop' || ev === 'SubagentStop') {
    const scope = scopeRoot(cwd)
    const cfg = loadConfig(scope)
    if (participates(scope, cfg)) heartbeat(scope, cfg, id)
    pass()
  }

  if (ev === 'SessionEnd') {
    const scope = scopeRoot(cwd)
    const cfg = loadConfig(scope)
    if (participates(scope, cfg)) done(scope, cfg, id)
    pass()
  }

  pass()
} catch { process.exit(0) }
