#!/usr/bin/env bash
set -euo pipefail

# Elkhedr Orca standalone installer.
# Usage:
#   curl -sSL https://raw.githubusercontent.com/ekagent/elkhedr-orca/main/install.sh | bash
#   ORCA_BRANCH=studio-enterprise-bridge bash install.sh

ORCA_REPO="${ORCA_REPO:-https://github.com/ekagent/elkhedr-orca.git}"
ORCA_BRANCH="${ORCA_BRANCH:-main}"
INSTALL_DIR="${ORCA_HOME:-$HOME/elkhedr-orca}"

echo "Installing Elkhedr Orca from $ORCA_REPO#$ORCA_BRANCH"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required." >&2
  exit 1
fi

if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" fetch origin "$ORCA_BRANCH"
  git -C "$INSTALL_DIR" switch "$ORCA_BRANCH" 2>/dev/null || git -C "$INSTALL_DIR" switch -c "$ORCA_BRANCH" "origin/$ORCA_BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$ORCA_BRANCH"
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --branch "$ORCA_BRANCH" "$ORCA_REPO" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

npm link

if [[ -n "${OPENROUTER_API_KEY:-}" && ! -f .env ]]; then
  printf 'OPENROUTER_API_KEY=%s\n' "$OPENROUTER_API_KEY" > .env
  chmod 600 .env
fi

cat <<EOF

Elkhedr Orca installed successfully.

Try:
  orca "Build a full-stack SaaS app and draft a marketing plan"

MCP config:
{
  "mcpServers": {
    "elkhedr-orca": {
      "command": "mcp-orca",
      "env": {
        "OPENROUTER_API_KEY": "\${OPENROUTER_API_KEY}"
      }
    }
  }
}
EOF
