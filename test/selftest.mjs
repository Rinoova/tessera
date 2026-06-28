// selftest.mjs — proves the load-bearing primitives: identity, scope, enc, and
// (critically) ATOMIC multi-writer appends to the bus under concurrency.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { selfId, isAlive, isValidId, bootId } from '../lib/identity.mjs'
import { scopeRoot, enc, realpathM } from '../lib/scope.mjs'
import { Bus, BusReader } from '../lib/bus.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗ FAIL:', m) } }

console.log('# identity')
const me = selfId()
ok(isValidId(me), `selfId is well-formed: ${me}`)
ok(isAlive(me), 'self is alive')
ok(!isAlive(`deadbeef-0000:999999:123`), 'foreign boot_id => dead')
ok(!isAlive('garbage'), 'malformed id => dead')

console.log('# scope + enc')
const sc = scopeRoot(join(__dir, '..', 'lib', 'identity.mjs'))
ok(sc.endsWith('/tessera'), `scopeRoot finds the tessera project root (package.json marker): ${sc}`)
ok(enc('deploy/.env-shared') === 'deploy%2F.env-shared', 'enc percent-encodes / safely')
ok(enc('a/../b') === 'a%2F..%2Fb' && !enc('a/../b').includes('/'), 'enc is traversal-free')
ok(realpathM(join(__dir, 'does-not-exist-yet', 'x')).endsWith('/does-not-exist-yet/x'), 'realpathM tolerates missing tail')

console.log('# bus: atomic concurrent multi-writer appends')
const dir = mkdtempSync(join(tmpdir(), 'as-self-'))
const bus = join(dir, 'bus.ndjson')
const N_WRITERS = 8, PER = 25
const child = `
import { Bus } from '${join(__dir, '..', 'lib', 'bus.mjs')}'
const b = new Bus('${bus}', 'aaaa:' + process.pid + ':1')
for (let i = 0; i < ${PER}; i++) b.append('edit', { ref: 'f' + i, msg: 'writer ' + process.pid + ' line ' + i })
`
const childFile = join(dir, 'child.mjs')
writeFileSync(childFile, child)

await Promise.all(Array.from({ length: N_WRITERS }, () => new Promise((res) => {
  const p = spawn(process.execPath, [childFile], { stdio: 'ignore' })
  p.on('exit', res)
})))

const reader = new BusReader(bus)
const events = reader.fold()
ok(events.length === N_WRITERS * PER, `read back exactly ${N_WRITERS * PER} events (got ${events.length}) — no torn/lost records`)
ok(events.every(e => e.type === 'edit' && typeof e.ref === 'string'), 'every record parsed cleanly under concurrency')
const reader2 = new BusReader(bus)
reader2.fold()
ok(reader2.fold().length === 0, 'second fold from same cursor yields 0 (no re-fire)')

// prototype-pollution defense
const poison = new BusReader(bus)
writeFileSync(bus, '\n{"__proto__":{"polluted":true},"type":"note","rid":"x:1:9"}', { flag: 'a' })
poison.fold()
ok(({}).polluted === undefined, 'prototype pollution via __proto__ key is neutralized')

rmSync(dir, { recursive: true, force: true })
console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
