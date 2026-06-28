// identity.mjs — kernel-authoritative agent identity & liveness.
// agent-id = "<boot_id>:<pid>:<starttime>". Defeats pid reuse (starttime) and
// cross-reboot stale state (boot_id). Liveness comes from /proc, never wall-clock.
import { readFileSync, existsSync } from 'node:fs'

let _bootId = null
export function bootId() {
  if (_bootId == null) {
    try { _bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() }
    catch { _bootId = 'noboot' }
  }
  return _bootId
}

// Fields of /proc/<pid>/stat AFTER the last ')'. comm (field 2) may contain
// spaces and ')'; splitting after the last ')' is the only correct parse.
// Returned array is 0-indexed from field 3: [0]=state(f3) [2]=pgrp(f5) [19]=starttime(f22).
function statAfterParen(pid) {
  const s = readFileSync(`/proc/${pid}/stat`, 'utf8')
  const i = s.lastIndexOf(')')
  if (i < 0) return null
  return s.slice(i + 1).trim().split(/\s+/)
}

export function starttime(pid) { try { const a = statAfterParen(pid); return a ? a[19] : null } catch { return null } }
export function pgrpOf(pid)   { try { const a = statAfterParen(pid); return a ? Number(a[2]) : null } catch { return null } }
export function stateOf(pid)  { try { const a = statAfterParen(pid); return a ? a[0] : null } catch { return null } }

export function selfId() {
  const pid = process.pid
  return `${bootId()}:${pid}:${starttime(pid)}`
}

const ID_RE = /^([0-9a-f-]+):(\d+):(\d+)$/
export function parseId(id) {
  if (typeof id !== 'string') return null
  const m = ID_RE.exec(id)
  return m ? { boot: m[1], pid: Number(m[2]), start: m[3] } : null
}
export function isValidId(id) { return parseId(id) != null }

// Liveness: foreign boot_id => unconditionally dead. Same boot => /proc/<pid>
// must exist AND starttime must match (pid-reuse guard). Hard veto on auto-reap.
export function isAlive(id) {
  const p = parseId(id)
  if (!p) return false
  if (p.boot !== bootId()) return false
  if (!existsSync(`/proc/${p.pid}`)) return false
  return starttime(p.pid) === p.start
}
