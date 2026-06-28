// dummy-agent.mjs — emulates a Claude agent's HOOK lifecycle for end-to-end testing
// (real `claude` would fire these same hook events). Reads AGENTSYNC_* env set by `up`.
import { execFileSync } from 'node:child_process'
const HOOK = process.env.AS_HOOK
const sid = process.env.AGENTSYNC_LABEL || ('sim:' + process.pid)
const cwd = process.cwd()
const files = (process.env.AS_FILES || 'src/shared.js').split(',')
const iters = parseInt(process.env.AS_ITERS || '10', 10)
const gap = parseInt(process.env.AS_GAP || '350', 10)

function hook(j) { try { execFileSync('node', [HOOK], { input: JSON.stringify({ ...j, session_id: sid, cwd }), stdio: ['pipe', 'ignore', 'ignore'] }) } catch {} }

hook({ hook_event_name: 'SessionStart' })
let i = 0
const t = setInterval(() => {
  const f = files[i % files.length]
  hook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: cwd + '/' + f } })
  hook({ hook_event_name: 'Stop' })
  if (++i >= iters) { clearInterval(t); hook({ hook_event_name: 'SessionEnd' }); process.exit(0) }
}, gap)
