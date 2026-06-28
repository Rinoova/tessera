// bus.mjs — the per-scope awareness bus: append-only NDJSON.
// Writes are framed with a LEADING '\n' so a torn predecessor self-heals (split
// on '\n', the bad fragment fails JSON.parse and is discarded, the committed
// successor survives). Order = byte-offset (single host => total order; no clocks).
// Reader is schema-tolerant, prototype-pollution-safe, and dedups by rid or content hash.
import { openSync, writeSync, closeSync, readSync, statSync, constants, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { selfId, bootId } from './identity.mjs'

export function fnv1a64(str) {
  let h = 0xcbf29ce484222325n
  const P = 0x100000001b3n, M = (1n << 64n) - 1n
  for (let i = 0; i < str.length; i++) { h ^= BigInt(str.charCodeAt(i)); h = (h * P) & M }
  return h.toString(16)
}

const WFLAGS = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW
const MAXLINE = 16 * 1024
const TAIL = 256 * 1024
const PARTIAL_CAP = 64 * 1024

// rid must be unique PER RECORD across all processes. Hooks run as short-lived
// separate processes (each a fresh pid), and many share one agent session_id, so
// rid keys on (pid, module-load time, counter) — globally unique on one host.
let _ridN = 0
const PROC_NONCE = `${process.pid}.${Date.now().toString(36)}`

export class Bus {
  constructor(busPath, id) { this.path = busPath; this.id = id || selfId() }
  append(type, fields = {}) {
    const ev = {
      ts: new Date().toISOString(), from: this.id, type,
      boot_id: bootId(), rid: `${PROC_NONCE}:${_ridN++}`,
      ...fields,
    }
    let line = JSON.stringify(ev)
    if (line.length > MAXLINE) { // never let one record corrupt the stream
      ev.msg = String(ev.msg || '').slice(0, 200)
      ev.truncated = true
      line = JSON.stringify(ev).slice(0, MAXLINE)
    }
    try { mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 }) } catch {}
    const fd = openSync(this.path, WFLAGS, 0o600)
    try { writeSync(fd, '\n' + line) } finally { closeSync(fd) }
    return ev
  }
}

export class BusReader {
  constructor(busPath) { this.path = busPath; this.cursor = { dev: 0, ino: 0, offset: 0 }; this.seen = new Set(); this.partial = '' }
  // Returns the new, valid, deduped events since the last fold().
  fold() {
    let st
    try { st = statSync(this.path) } catch { return [] }
    if (st.ino !== this.cursor.ino || st.dev !== this.cursor.dev) {
      // first read or inode swap (only via offline doctor --gc): cold-read tail, dedup avoids re-fire
      this.cursor = { dev: st.dev, ino: st.ino, offset: Math.max(0, st.size - TAIL) }
      this.partial = ''
    }
    if (st.size < this.cursor.offset) { this.cursor.offset = 0; this.partial = '' } // truncated
    if (st.size === this.cursor.offset) return []
    const fd = openSync(this.path, 'r')
    const out = []
    try {
      let pos = this.cursor.offset
      const buf = Buffer.allocUnsafe(65536)
      while (pos < st.size) {
        const n = readSync(fd, buf, 0, Math.min(buf.length, st.size - pos), pos)
        if (n <= 0) break
        pos += n
        this.partial += buf.toString('utf8', 0, n)
        let idx
        while ((idx = this.partial.indexOf('\n')) >= 0) {
          const seg = this.partial.slice(0, idx)
          this.partial = this.partial.slice(idx + 1)
          const ev = this._parse(seg)
          if (ev) out.push(ev)
        }
        if (this.partial.length > PARTIAL_CAP) this.partial = '' // discard runaway (no newline) fragment
      }
      this.cursor.offset = pos
      // The final record has no trailing '\n' (leading-delimiter framing), so the
      // split loop never flushes it. Emit it if it's a complete record; dedup by
      // rid/hash makes the later newline-terminated copy a no-op. A genuinely torn
      // last write fails JSON.parse and stays buffered until the next writer's '\n'.
      if (this.partial) { const ev = this._parse(this.partial); if (ev) out.push(ev) }
    } finally { closeSync(fd) }
    return out
  }
  _parse(seg) {
    seg = seg.trim()
    if (!seg) return null
    let o
    try { o = JSON.parse(seg) } catch { return null }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null
    const id = (typeof o.rid === 'string' && o.rid) ? o.rid : fnv1a64(seg)
    if (this.seen.has(id)) return null
    this.seen.add(id)
    const safe = Object.create(null) // prototype-pollution safe
    for (const k of Object.keys(o)) { if (k === '__proto__') continue; safe[k] = o[k] }
    safe._id = id
    return safe
  }
}
