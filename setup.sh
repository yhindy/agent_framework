#!/bin/bash
# First-time setup script for Agent Framework

set -e

cd "$(dirname "$0")"

echo "=== Agent Framework Setup ==="
echo ""

# Check requirements
echo "Checking requirements..."

if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is required. Install from https://nodejs.org"
  exit 1
fi

if ! command -v git &> /dev/null; then
  echo "ERROR: Git is required."
  exit 1
fi

if ! command -v python3 &> /dev/null; then
  echo "ERROR: Python 3 is required."
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "ERROR: Node.js 18+ required (you have $(node -v))"
  exit 1
fi

echo "  Node.js: $(node -v)"
echo "  Git: $(git --version | cut -d' ' -f3)"
echo "  Python: $(python3 --version | cut -d' ' -f2)"
echo ""
echo "All requirements met!"
echo ""

# Install dependencies
echo "Installing dependencies..."
npm install

# Rebuild native modules for Electron
echo ""
echo "Rebuilding native modules for Electron..."
cd gui
npm run rebuild
cd ..

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To start the GUI, run:"
echo "  ./run.sh"
