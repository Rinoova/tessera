// proc.mjs — map a flock sidecar to its kernel-confirmed holder via /proc/locks.
// The holder pid/pgrp here are the ONLY valid kill targets — never bus-self-written ids.
import { readFileSync, statSync } from 'node:fs'
import { pgrpOf, starttime, stateOf, bootId } from './identity.mjs'

// "N: FLOCK ADVISORY WRITE <pid> <maj>:<min>:<ino> <start> <end>"
export function lockHolders() {
  let txt
  try { txt = readFileSync('/proc/locks', 'utf8') } catch { return [] }
  const out = []
  for (const line of txt.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const p = t.split(/\s+/)
    if (p.length < 6) continue
    const pid = Number(p[4])
    const devino = p[5]
    if (!pid || !devino.includes(':')) continue
    out.push({ kind: p[1], mode: p[3], pid, ino: Number(devino.split(':').pop()) })
  }
  return out
}

// Which process holds the flock on this sidecar? Match by inode (decimal in /proc/locks).
export function holderOf(sidecarPath) {
  let ino
  try { ino = statSync(sidecarPath).ino } catch { return null }
  for (const h of lockHolders()) {
    if (h.ino === ino) {
      const pid = h.pid
      return { pid, pgrp: pgrpOf(pid), start: starttime(pid), state: stateOf(pid), boot: bootId() }
    }
  }
  return null
}
