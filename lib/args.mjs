// args.mjs — tiny flag parser. --k v, --k=v, --flag (boolean), -n K, positionals.
export function parseArgs(argv, { booleans = [], aliases = {} } = {}) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    if (a.startsWith('--')) {
      a = a.slice(2)
      const eq = a.indexOf('=')
      if (eq >= 0) { out[a.slice(0, eq)] = a.slice(eq + 1); continue }
      if (booleans.includes(a)) { out[a] = true; continue }
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('-')) { out[a] = true } else { out[a] = next; i++ }
    } else if (a.startsWith('-') && a.length > 1) {
      const k = aliases[a] || a.slice(1)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('-')) { out[k] = true } else { out[k] = next; i++ }
    } else { out._.push(a) }
  }
  return out
}
