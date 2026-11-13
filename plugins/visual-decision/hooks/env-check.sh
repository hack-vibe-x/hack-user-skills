#!/bin/sh
# Checks that Node.js 18 or later is on the computer. It installs nothing itself.
#   env-check.sh        SessionStart hook. Silent when Node.js is there, or when the user chose "do not ask again" (the file below).
#                       Otherwise tells Claude to ask the user what to do, with the exact install command decided here so nothing is improvised.
#   env-check.sh path   prints the Node.js to use and exits 0, or exits 1 when there is none. The other hooks use it to find node.
SKIP="$HOME/.hus-visual-decision/no-env-check"

node_ok() { [ -x "$1" ] && "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' >/dev/null 2>&1; }

# A hook can start with a shorter PATH than the user's terminal, and a version manager's folder can vanish with its terminal window.
# So after PATH, look where version managers and Homebrew keep Node.js.
find_node() {
  p=$(command -v node 2>/dev/null)
  if [ -n "$p" ] && node_ok "$p"; then echo "$p"; return 0; fi
  for c in "$HOME"/.nvm/versions/node/*/bin/node \
    "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node \
    "$HOME/Library/Application Support/fnm/node-versions/"*/installation/bin/node \
    "$HOME/.volta/bin/node" "$HOME/.local/share/mise/shims/node" "$HOME/.asdf/shims/node" \
    ${HUS_VISUAL_DECISION_NODE_PATHS:-/opt/homebrew/bin/node /usr/local/bin/node}; do
    if node_ok "$c"; then echo "$c"; return 0; fi
  done
  return 1
}

if [ "$1" = path ]; then find_node; exit $?; fi
[ -e "$SKIP" ] && exit 0
find_node >/dev/null && exit 0

# What is on the computer but too old, so the question can say so.
old=""
p=$(command -v node 2>/dev/null)
if [ -n "$p" ]; then
  v=$("$p" -v 2>/dev/null)
  [ -n "$v" ] && old=" Node.js $v is on this computer ($p), but it is older than 18."
fi

# Homebrew installs without an administrator password. Nothing else is used: no sudo, no installer scripts.
brew=$(command -v brew 2>/dev/null)
for b in ${HUS_VISUAL_DECISION_BREW_PATHS:-/opt/homebrew/bin/brew /usr/local/bin/brew}; do [ -z "$brew" ] && [ -x "$b" ] && brew=$b; done

skip_cmd="mkdir -p ~/.hus-visual-decision && touch ~/.hus-visual-decision/no-env-check"
text="The plugin hack-user-skills-visual-decision needs Node.js 18 or later, which is not usable on this computer.$old Until then its question page cannot open, and questions stay in the terminal. Do not install anything yet. In your next reply, ask the user what to do with the AskUserQuestion tool, in the user's language and in plain words for someone who is not technical."
if [ -n "$brew" ]; then
  new="${brew%/brew}/node"
  text="$text Options: (1) 'Install it for me': you run exactly \`$brew install node\` and nothing else, then run \`$new -v\` and report in one sentence whether it worked. If an older Node.js still comes first in their PATH, say so in one sentence and give them the path $new; do not edit any shell file. (2) 'Send me the command': show \`$brew install node\` and say they can paste it into a terminal themselves. (3) 'Not now': do nothing; you will ask again next session. (4) 'Do not ask again': you run \`$skip_cmd\`. Say these reassuring facts in the question: nothing is installed until they choose; it is the standard Node.js package from Homebrew, which is already on this computer; no administrator password is needed; Homebrew may also add a few small packages Node.js depends on; it can be removed any time with \`brew uninstall node\`. Never use sudo and never install Homebrew itself."
else
  text="$text No package manager that installs without an administrator password was found, so do not install anything yourself. Options: (1) 'Show me how to install': give the download page https://nodejs.org (choose the LTS version, then restart Claude Code), and offer to check again once they are done. (2) 'Not now': do nothing; you will ask again next session. (3) 'Do not ask again': you run \`$skip_cmd\`. Say these reassuring facts in the question: nothing is installed on their computer by this plugin; Node.js is a free, widely used tool from its official site."
fi
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$text"
