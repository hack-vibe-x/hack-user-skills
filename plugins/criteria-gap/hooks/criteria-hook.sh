#!/bin/sh
# Always exits 0 so that a missing or failing python3 never blocks the user's input.
HERE=$(cd "$(dirname "$0")" && pwd)
PY=$(command -v python3) || exit 0
"$PY" "$HERE/criteria_hook.py" || exit 0
exit 0
