#!/bin/sh
# Fast pre-filter so the GLOBAL hook is a near-zero-cost no-op in projects that
# don't use Tessera (avoids ~40ms node startup on every tool call everywhere).
# If the project clearly participates, exec the real node handler (which inherits
# stdin). Otherwise consume stdin and exit 0 without starting node.
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ "$TESSERA_AUTO" = "1" ] || [ -n "$TESSERA_TOUCHES" ]; then
  exec node "$DIR/tessera-hook.mjs"
fi

d="$PWD"
while [ -n "$d" ]; do
  if [ -d "$d/.tessera" ]; then exec node "$DIR/tessera-hook.mjs"; fi
  [ "$d" = "/" ] && break
  d=$(dirname -- "$d")
done

cat >/dev/null 2>&1
exit 0
