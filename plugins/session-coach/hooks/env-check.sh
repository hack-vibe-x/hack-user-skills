#!/bin/sh
# SessionStart hook. Checks that Python 3.9 or later is on the computer. It installs nothing itself.
# Silent when Python is there, or when the user chose "do not ask again" (the file below).
# Otherwise it tells Claude to ask the user what to do, with the exact install command decided here so nothing is improvised.
SKIP="$HOME/.hus-session-coach/no-env-check"

py_ok() { [ -x "$1" ] && "$1" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; }

# On a Mac without developer tools /usr/bin/python3 is a stub that opens an install dialog when run, so it is not run.
is_stub() { [ "$1" = /usr/bin/python3 ] && [ "$(uname -s)" = Darwin ] && ! xcode-select -p >/dev/null 2>&1; }

# A hook can start with a shorter PATH than the user's terminal, so after PATH look where version managers and Homebrew keep Python.
find_python() {
  p=$(command -v python3 2>/dev/null)
  if [ -n "$p" ] && ! is_stub "$p" && py_ok "$p"; then echo "$p"; return 0; fi
  for c in "$HOME"/.pyenv/versions/*/bin/python3 "$HOME/.pyenv/shims/python3" \
    "$HOME/.local/share/mise/shims/python3" "$HOME/.asdf/shims/python3" \
    ${HUS_SESSION_COACH_PYTHON_PATHS:-/opt/homebrew/bin/python3 /usr/local/bin/python3}; do
    if py_ok "$c"; then echo "$c"; return 0; fi
  done
  return 1
}

[ -e "$SKIP" ] && exit 0
find_python >/dev/null && exit 0

# What is on the computer but too old, so the question can say so.
old=""
p=$(command -v python3 2>/dev/null)
if [ -n "$p" ] && ! is_stub "$p"; then
  v=$("$p" --version 2>/dev/null)
  [ -n "$v" ] && old=" $v is on this computer ($p), but it is older than 3.9."
fi

# Homebrew installs without an administrator password. Nothing else is used: no sudo, no installer scripts.
brew=$(command -v brew 2>/dev/null)
for b in ${HUS_SESSION_COACH_BREW_PATHS:-/opt/homebrew/bin/brew /usr/local/bin/brew}; do [ -z "$brew" ] && [ -x "$b" ] && brew=$b; done

skip_cmd="mkdir -p ~/.hus-session-coach && touch ~/.hus-session-coach/no-env-check"
text="The plugin hack-user-skills-session-coach needs Python 3.9 or later, which is not usable on this computer.$old Until then the session diary and the session playbook skills cannot run. Do not install anything yet. In your next reply, ask the user what to do with the AskUserQuestion tool, in the user's language and in plain words for someone who is not technical."
if [ -n "$brew" ]; then
  new="${brew%/brew}/python3"
  text="$text Options: (1) 'Install it for me': you run exactly \`$brew install python\` and nothing else, then run \`$new --version\` and report in one sentence whether it worked. If an older Python still comes first in their PATH, say so in one sentence and give them the path $new; do not edit any shell file. (2) 'Send me the command': show \`$brew install python\` and say they can paste it into a terminal themselves. (3) 'Not now': do nothing; you will ask again next session. (4) 'Do not ask again': you run \`$skip_cmd\`. Say these reassuring facts in the question: nothing is installed until they choose; it is the standard Python package from Homebrew, which is already on this computer; no administrator password is needed; Homebrew may also add a few small packages Python depends on; it can be removed any time with \`brew uninstall python\`. Never use sudo and never install Homebrew itself."
else
  text="$text No package manager that installs without an administrator password was found, so do not install anything yourself. Options: (1) 'Show me how to install': give the download page https://www.python.org/downloads/ (the newest version, then restart Claude Code), and offer to check again once they are done. (2) 'Not now': do nothing; you will ask again next session. (3) 'Do not ask again': you run \`$skip_cmd\`. Say these reassuring facts in the question: nothing is installed on their computer by this plugin; Python is a free, widely used tool from its official site."
fi
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$text"
