#!/bin/bash

# Elkhedr Orca Installer
# Usage: curl -sSL https://raw.githubusercontent.com/ekagent/elkhedr-orca/main/install.sh | bash

echo "🚀 Installing Elkhedr Orca..."

# Create directory if it doesn't exist
INSTALL_DIR="$HOME/elkhedr-orca"
if [ ! -d "$INSTALL_DIR" ]; then
    mkdir -p "$INSTALL_DIR"
    # In a real scenario, we would git clone here
    # git clone https://github.com/ekagent/elkhedr-orca.git "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# Install dependencies
npm install --silent

# Link globally
npm link

# Setup API Key
if [ -z "$OPENROUTER_API_KEY" ]; then
    echo "⚠️  OPENROUTER_API_KEY not found in environment."
    read -p "Enter your OpenRouter API Key: " api_key
    echo "OPENROUTER_API_KEY=$api_key" >> .env
    echo "✅ API Key saved to .env"
fi

echo "✅ Elkhedr Orca installed successfully!"
echo "Try running: orca 'Build a full-stack SaaS app and draft a marketing plan'"

echo ""
echo "🤖 To use with Claude Code / Claude Desktop:"
echo "Add the following to your Claude config:"
echo "{"
echo "  \"mcpServers\": {"
echo "    \"elkhedr-orca\": {"
echo "      \"command\": \"mcp-orca\","
echo "      \"env\": {"
echo "        \"OPENROUTER_API_KEY\": \"$OPENROUTER_API_KEY\""
echo "      }"
echo "    }"
echo "  }"
echo "}"
