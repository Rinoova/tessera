// scope.mjs — generic, portable scope detection + path canonicalization.
// scope(target) = nearest project root by walking realpath UP an ordered marker
// list. Visibility = path-overlap: the scope dir physically holds the bus, so two
// agents share a medium iff their targets resolve into the same scope (Linda
// tuple-centre "local laws, global effect"). Works in polyrepo, monorepo, single repo.
import { realpathSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, basename, join } from 'node:path'

// Ordered default markers (most-specific first). Override per-project via config.
export const DEFAULT_MARKERS = [
  '.agentsync-scope', '.git',
  'package.json', 'deno.json', 'go.mod', 'pyproject.toml', 'setup.py',
  'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'composer.json', 'Gemfile', 'mix.exs', 'Makefile',
]

// realpath -m semantics: resolve symlinks of the existing prefix, tolerate a
// not-yet-existing final component (e.g. a config that's only *.example today).
export function realpathM(p) {
  const abs = resolve(p)
  const missing = []
  let cur = abs
  while (cur && !existsSync(cur)) {
    missing.unshift(basename(cur))
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  let base
  try { base = realpathSync(cur) } catch { base = cur }
  return missing.length ? join(base, ...missing) : base
}

function isDirSafe(p) { try { return statSync(p).isDirectory() } catch { return false } }

// scope(target) = the nearest realpath ANCESTOR bearing ANY marker (DISTANCE-first):
// in a monorepo (root .git + crates/foo/Cargo.toml) editing crates/foo/* resolves
// to crates/foo, NOT the repo root — so disjoint subtrees stay mutually invisible.
// The marker *order* is only a same-dir tiebreak. `.agentsync-scope` is the sole
// up-tree OVERRIDE: if found at any ancestor it wins regardless of distance, letting
// a user pin a whole subtree to one scope. Walks from the TARGET's realpath, not cwd.
// NOTE: a `.git` FILE (worktree or submodule pointer) is treated as a plain marker
// here — scope = the dir holding it. We deliberately do NOT chase the gitdir pointer
// in awareness mode (chasing a submodule pointer yields a nonsense path inside the
// parent's .git); worktree→main canonicalization belongs to opt-in flock mode.
export function scopeRoot(target, opts = {}) {
  const markers = opts.markers || DEFAULT_MARKERS
  const boundary = opts.boundary ? realpathM(opts.boundary) : null
  const p = realpathM(target)
  const startDir = isDirSafe(p) ? p : dirname(p)
  let override = null, nearestMarker = null
  let cur = startDir
  while (true) {
    if (override == null && existsSync(join(cur, '.agentsync-scope'))) override = cur
    if (nearestMarker == null) {
      for (const m of markers) { if (existsSync(join(cur, m))) { nearestMarker = cur; break } }
    }
    if (boundary && cur === boundary) break
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return override || nearestMarker || startDir
}

// Nearest ancestor holding a `.git` (dir OR file), or null. Used to git-gate
// install/up so non-git projects (incl. this non-git polyroot) still work.
export function enclosingGitRoot(target) {
  let cur = realpathM(target)
  if (!isDirSafe(cur)) cur = dirname(cur)
  while (true) {
    if (existsSync(join(cur, '.git'))) return cur
    const parent = dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

// Injective, separator-free, traversal-free encoding of a path/key into a single
// filename for a flock sidecar. Percent-encodes every byte outside [A-Za-z0-9._-]
// (including '/'). flock(1) opens the sidecar by path, so this must be safe.
export function enc(key) {
  const b = Buffer.from(key, 'utf8')
  let s = ''
  for (const byte of b) {
    const ok = (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) ||
               (byte >= 97 && byte <= 122) || byte === 46 || byte === 95 || byte === 45
    s += ok ? String.fromCharCode(byte) : '%' + byte.toString(16).padStart(2, '0').toUpperCase()
  }
  if (s === '' || s === '.' || s === '..') throw new Error(`unsafe enc key: ${JSON.stringify(key)}`)
  return s
}

export function agentsyncDir(scope, cfg = {}) { return join(scope, cfg.dir || '.agentsync') }
export function busPath(scope, cfg = {}) {
  return cfg.bus_path ? join(scope, cfg.bus_path) : join(agentsyncDir(scope, cfg), 'bus.ndjson')
}
