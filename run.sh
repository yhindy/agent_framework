#!/bin/bash
# Launch the Agent Framework GUI

set -e

cd "$(dirname "$0")"

# Check if setup has been run
if [ ! -d "node_modules" ]; then
  echo "❌ ERROR: Dependencies not installed."
  echo ""
  echo "Looks like you haven't run setup yet!"
  echo "Run this first:"
  echo "  ./setup.sh"
  echo ""
  exit 1
fi

# Check if electron is installed (key dependency for GUI)
if [ ! -d "node_modules/electron" ]; then
  echo "❌ ERROR: GUI dependencies not installed."
  echo ""
  echo "Something went wrong with setup. Try running:"
  echo "  ./setup.sh"
  echo ""
  exit 1
fi

echo "🚀 Starting Agent Framework GUI..."
echo ""

# Rebuild native modules (node-pty) if needed
if [ ! -f "gui/node_modules/node-pty/build/Release/pty.node" ]; then
  echo "Rebuilding native modules..."
  npm run rebuild -w gui
  echo ""
fi

# Multiple instances are supported - each gets its own API port
npm run gui:dev
