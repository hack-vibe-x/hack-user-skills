#!/bin/sh
# Runs one of this plugin's Node.js hooks:  sh run-node.sh <hook.mjs>
# It finds Node.js 18 or later through env-check.sh, which also looks where version managers and Homebrew keep it.
# Without one it exits quietly; env-check.sh, the SessionStart hook, is the one that tells the user.
n=$(sh "${0%/*}/env-check.sh" path) || exit 0
exec "$n" "$1"
