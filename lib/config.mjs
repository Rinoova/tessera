// config.mjs — per-scope configuration with lean defaults.
// tier1 is EMPTY by default: a fresh project gets ONLY worktree-isolation +
// the awareness bus. flock hard-locking activates only when a project declares
// genuinely-shared, non-git-mergeable files (or enables a profile that derives them).
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_MARKERS, agentsyncDir } from './scope.mjs'

export const DEFAULTS = {
  dir: '.agentsync',
  bus_path: null,                                  // default <scope>/.agentsync/bus.ndjson; set to reuse an existing dir
  markers: DEFAULT_MARKERS,
  boundary: process.env.AGENTSYNC_ROOT || null,
  tier1: [],                                       // glob list of shared non-mergeable files needing flock
  profile: null,                                   // optional named profile (e.g. "compose-env")
}

export function loadConfig(scope) {
  const cfg = { ...DEFAULTS }
  const f = join(agentsyncDir(scope, cfg), 'config.json')
  if (existsSync(f)) {
    try { Object.assign(cfg, JSON.parse(readFileSync(f, 'utf8'))) } catch {}
  }
  return cfg
}
