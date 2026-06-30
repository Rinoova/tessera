// gc — OFFLINE compaction: bound the per-scope append-only bus and reap dead presence.
// The bus is never read at runtime (it's a durable write-only log), so it grows forever
// until compacted. gc rewrites it via an atomic rename (INODE SWAP) — exactly what
// BusReader.fold already tolerates (lib/bus.mjs) — keeping the last N records and/or
// records newer than --max-age. It REFUSES while a live peer is present (unless --force),
// because a concurrent O_APPEND writer would lose in-flight appends into the swapped-out
// inode; the bus is advisory, so --force is acceptable but explicit.
// Presence: reaps every non-live file in the scope (a stray reap of an idle agent self-heals
// via the PreToolUse announce latch). See docs/ACTIVATION.md and the plan for rationale.
import { readFileSync, writeFileSync, statSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from '../lib/args.mjs'
import { realpathM, scopeRoot, busPath, tesseraDir } from '../lib/scope.mjs'
import { loadConfig } from '../lib/config.mjs'
import { listPresence } from '../lib/coord.mjs'
import { cacheDir, listAutoScopes } from '../lib/registry.mjs'

const DEFAULT_KEEP = 5000
const DEFAULT_MAX_AGE_DAYS = 14
const kb = (b) => (b / 1024).toFixed(0)

export async function run(argv) {
  const a = parseArgs(argv, { booleans: ['all', 'dry-run', 'force'], aliases: { n: 'keep' } })
  const keep = a.keep != null && a.keep !== true ? Math.max(0, parseInt(a.keep, 10) || DEFAULT_KEEP) : DEFAULT_KEEP
  const days = a['max-age'] != null && a['max-age'] !== true ? Number(a['max-age']) : DEFAULT_MAX_AGE_DAYS
  const maxAgeMs = Number.isFinite(days) && days > 0 ? days * 86400_000 : 0
  const dry = !!a['dry-run']
  const current = scopeRoot(realpathM(a.scope || process.cwd()))
  const scopes = a.all ? discoverScopes(current) : [current]
  if (!scopes.length) { console.log('No opted-in scopes found to gc.'); return }

  console.log(`Tessera gc${dry ? ' (dry-run)' : ''} — keep last ${keep} bus records${maxAgeMs ? `, max age ${days}d` : ''}`)
  for (const scope of scopes) {
    const cfg = loadConfig(scope)
    console.log(`\n${scope}`)
    for (const line of gcScope(scope, cfg, { keep, maxAgeMs, dry, force: !!a.force })) console.log('  ' + line)
  }
  if (dry) console.log('\n(dry-run — nothing was modified)')
}

// --all scope discovery reuses existing global data: distinct scopes in the session
// registry + the auto-opt-in inventory + the current scope, filtered to ones still
// opted-in. (There is no global index of explicitly-opted-in scopes, so this is a
// best-effort set — pass --scope DIR to gc a specific project not seen recently.)
function discoverScopes(current) {
  const set = new Set([current])
  try {
    for (const l of readFileSync(join(cacheDir(), 'sessions.ndjson'), 'utf8').split('\n')) {
      const s = l.trim(); if (!s) continue
      try { const sc = JSON.parse(s).scope; if (sc) set.add(sc) } catch {}
    }
  } catch {}
  for (const s of listAutoScopes()) set.add(s)
  return [...set].filter(s => existsSync(tesseraDir(s)))
}

function gcScope(scope, cfg, { keep, maxAgeMs, dry, force }) {
  const report = []

  // --- bus: keep last N and/or records newer than max-age ---
  const busP = busPath(scope, cfg)
  if (!existsSync(busP)) report.push('bus: absent')
  else {
    const before = statSync(busP).size
    const recs = []
    for (const seg of readFileSync(busP, 'utf8').split('\n')) {
      const s = seg.trim(); if (!s) continue
      let ts = 0; try { ts = Date.parse(JSON.parse(s).ts) || 0 } catch {}
      recs.push({ s, ts })
    }
    const cutoff = maxAgeMs ? Date.now() - maxAgeMs : 0
    const aged = cutoff ? recs.filter(r => r.ts === 0 || r.ts >= cutoff) : recs  // keep unparseable-ts records
    const kept = aged.slice(-keep)
    const removed = recs.length - kept.length
    if (removed <= 0) report.push(`bus: ${recs.length} records, ${kb(before)} KB — nothing to compact`)
    else if (dry) report.push(`bus: WOULD prune ${removed} of ${recs.length} records → keep ${kept.length} (${kb(before)} KB)`)
    else {
      const live = listPresence(scope, cfg).filter(p => p._live).length
      if (live > 0 && !force) report.push(`bus: ${removed}/${recs.length} prunable, but ${live} live peer(s) present — skipped (use --force)`)
      else {
        // Atomic inode swap. Mirror the leading-'\n' framing so the next appender stays consistent.
        const tmp = busP + '.gc.' + process.pid + '.tmp'
        writeFileSync(tmp, '\n' + kept.map(r => r.s).join('\n'), { mode: 0o600 })
        renameSync(tmp, busP)
        report.push(`bus: pruned ${removed} records (${recs.length}→${kept.length}), ${kb(before)}→${kb(statSync(busP).size)} KB`)
      }
    }
  }

  // --- presence: reap every non-live file (aggressive — offline, user-invoked) ---
  const dead = listPresence(scope, cfg).filter(p => !p._live).length
  if (!dead) report.push('presence: none stale')
  else if (dry) report.push(`presence: WOULD reap ${dead} stale file(s)`)
  else { listPresence(scope, cfg, { reap: true, reapAll: true }); report.push(`presence: reaped ${dead} stale file(s)`) }

  return report
}
