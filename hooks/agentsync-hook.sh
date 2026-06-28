#!/bin/sh
# Fast pre-filter so the GLOBAL hook is a near-zero-cost no-op in projects that
# don't use AgentSync (avoids ~40ms node startup on every tool call everywhere).
# If the project clearly participates, exec the real node handler (which inherits
# stdin). Otherwise consume stdin and exit 0 without starting node.
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ "$AGENTSYNC_AUTO" = "1" ] || [ -n "$AGENTSYNC_TOUCHES" ]; then
  exec node "$DIR/agentsync-hook.mjs"
fi

d="$PWD"
while [ -n "$d" ]; do
  if [ -d "$d/.agentsync" ]; then exec node "$DIR/agentsync-hook.mjs"; fi
  [ "$d" = "/" ] && break
  d=$(dirname -- "$d")
done

cat >/dev/null 2>&1
exit 0
