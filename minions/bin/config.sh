#!/bin/bash
# Agent Framework Configuration
# Edit this file to customize the framework for your project

# ============================================================================
# PROJECT SETTINGS
# ============================================================================

# Project name - used for worktree folder names
# Worktrees will be created as: ../<PROJECT_NAME>-agent-1, etc.
# Auto-detect from git repository directory name
PROJECT_NAME=$(basename "$(git rev-parse --show-toplevel)")

# Default base branch for new feature branches
# Auto-detect the default branch (main, master, or whatever is configured)
if git rev-parse --verify main >/dev/null 2>&1; then
    DEFAULT_BASE_BRANCH="main"
elif git rev-parse --verify master >/dev/null 2>&1; then
    DEFAULT_BASE_BRANCH="master"
else
    # Fallback: try to get from remote HEAD
    DEFAULT_BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
fi

# ============================================================================
# FILES TO COPY
# ============================================================================

# Files/directories to copy from main repo to worktrees
# These are typically gitignored files that agents need
# Format: "source:destination" (relative to repo root)
# Example: "apps/mobile/lib/config/env.dart:apps/mobile/lib/config/env.dart"
FILES_TO_COPY=(
    # ".env:.env"
    # "config/secrets.json:config/secrets.json"
)

# ============================================================================
# POST-SETUP COMMANDS
# ============================================================================

# Commands to run after creating a worktree
# These run from the worktree root directory
POST_SETUP_COMMANDS=(
    # "npm install"
    # "pip install -r requirements.txt"
    # "bundle install"
)

# ============================================================================
# PREFLIGHT CHECKS
# ============================================================================

# Files that must exist for the project to run
# Preflight check will fail if these are missing
REQUIRED_FILES=(
    # ".env"
    # "config/secrets.json"
)

# Commands to verify environment is ready
PREFLIGHT_COMMANDS=(
    # "docker info > /dev/null 2>&1"
    # "node --version > /dev/null 2>&1"
)

