#!/bin/bash
# Launch the Agent Framework GUI

set -e

cd "$(dirname "$0")"

# Check if setup has been run
if [ ! -d "node_modules" ]; then
  echo "ERROR: Dependencies not installed."
  echo "Run ./setup.sh first"
  exit 1
fi

if [ ! -d "gui/node_modules" ]; then
  echo "ERROR: GUI dependencies not installed."
  echo "Run ./setup.sh first"
  exit 1
fi

echo "Starting Agent Framework GUI..."
npm run gui:dev
