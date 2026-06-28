// agentsync-hook.mjs — the single Claude Code hook handler.
// Reads hook JSON on stdin, dispatches on hook_event_name. Awareness mode:
// announces presence, records what each agent touches, surfaces live peers.
// FAIL-OPEN: any internal error exits 0 silently so coordination never blocks an agent.
import { readFileSync } from 'node:fs'
import { scopeRoot } from '../lib/scope.mjs'
import { loadConfig } from '../lib/config.mjs'
import {
  participates, announce, heartbeat, recordEdit, done, overlapWarning, readPresence,
} from '../lib/coord.mjs'

function readStdin() {
  try { return JSON.parse(readFileSync(0, 'utf8')) } catch { return {} }
}
function out(obj) { process.stdout.write(JSON.stringify(obj)); process.exit(0) }
function pass() { process.exit(0) }

const MUTATORS = /^(Edit|Write|MultiEdit|NotebookEdit)$|^mcp__.*(write|edit|create|put|save)/i

function targetPath(j) {
  const ti = j.tool_input || {}
  return ti.file_path || ti.path || ti.notebook_path || null
}

try {
  const j = readStdin()
  const ev = j.hook_event_name || j.hookEventName
  const id = j.session_id || j.sessionId || `nosid:${j.cwd || process.cwd()}`
  const cwd = j.cwd || process.cwd()
  const label = process.env.AGENTSYNC_LABEL || null
  const task = process.env.AGENTSYNC_TASK || null

  if (ev === 'SessionStart') {
    const scope = scopeRoot(cwd)
    const cfg = loadConfig(scope)
    if (!participates(scope, cfg)) pass()
    const digest = announce(scope, cfg, id, { cwd, label, task, role: process.env.AGENTSYNC_ROLE || 'agent' })
    if (digest) out({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: digest } })
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
    if (warn && process.env.AGENTSYNC_GUARD === '1') {
      out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: warn + ' (AGENTSYNC_GUARD active) — wait or pick a different file.' } })
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
