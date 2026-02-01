#!/bin/bash
# First-time setup script for Agent Framework

set -e

cd "$(dirname "$0")"

echo "🎉 Agent Framework Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check requirements
echo "📋 Checking requirements..."
echo ""

if ! command -v node &> /dev/null; then
  echo "❌ ERROR: Node.js is required but not found."
  echo "   Install from https://nodejs.org (version 18 or higher)"
  exit 1
fi

if ! command -v git &> /dev/null; then
  echo "❌ ERROR: Git is required but not found."
  echo "   Install from https://git-scm.com"
  exit 1
fi

if ! command -v python3 &> /dev/null; then
  echo "❌ ERROR: Python 3 is required but not found."
  echo "   Most systems have this pre-installed. Check your package manager."
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "❌ ERROR: Node.js 20+ required (you have $(node -v))"
  echo "   Please upgrade from https://nodejs.org"
  exit 1
fi

echo "✅ Node.js: $(node -v)"
echo "✅ Git: $(git --version | cut -d' ' -f3)"
echo "✅ Python: $(python3 --version | cut -d' ' -f2)"
echo ""
echo "All requirements met!"
echo ""

# Check if node_modules is corrupted (exists but missing key packages)
if [ -d "node_modules" ] && [ ! -d "node_modules/electron" ]; then
  echo "⚠️  Found corrupted node_modules directory. Cleaning up..."
  rm -rf node_modules package-lock.json
fi

# Install dependencies
echo "📦 Installing dependencies..."
echo "   This may take a few minutes on first run..."
echo ""
npm install

# Rebuild native modules for Electron
echo ""
echo "🔧 Rebuilding native modules for Electron..."
echo "   (This ensures the terminal integration works properly)"
echo ""
cd gui
npm run rebuild
cd ..

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Setup Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo "  1. Launch the GUI:  ./run.sh"
echo "  2. Read the guide:  cat GETTING_STARTED.md"
echo ""
echo "Questions? Check out GETTING_STARTED.md for a full walkthrough."
echo ""
