#!/bin/sh
# Fast pre-filter so the GLOBAL hook is a near-zero-cost no-op in projects that
# don't use Tessera (avoids ~40ms node startup on every tool call everywhere).
# The EDIT hot path (PreToolUse/Stop/...) only starts node where the project
# participates. SessionStart ALWAYS starts node — once per session — so a lone
# agent registers in the global session registry and a 2nd agent can detect it
# (the auto-opt-in safety net). See docs/ACTIVATION.md.
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
input=$(cat)

# SessionStart: always run node (registry heartbeat + collision detection).
case "$input" in
  *'"SessionStart"'*) printf '%s' "$input" | node "$DIR/tessera-hook.mjs"; exit 0 ;;
esac

# Everything else: participation gate — only run node where the project opted in.
if [ "$TESSERA_AUTO" = "1" ] || [ -n "$TESSERA_TOUCHES" ]; then
  printf '%s' "$input" | node "$DIR/tessera-hook.mjs"; exit 0
fi

d="$PWD"
while [ -n "$d" ]; do
  if [ -d "$d/.tessera" ]; then printf '%s' "$input" | node "$DIR/tessera-hook.mjs"; exit 0; fi
  [ "$d" = "/" ] && break
  d=$(dirname -- "$d")
done

exit 0
