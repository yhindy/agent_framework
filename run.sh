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

if [ ! -d "gui/node_modules" ]; then
  echo "❌ ERROR: GUI dependencies not installed."
  echo ""
  echo "Something went wrong with setup. Try running:"
  echo "  ./setup.sh"
  echo ""
  exit 1
fi

echo "🚀 Starting Agent Framework GUI..."
echo ""
npm run gui:dev
