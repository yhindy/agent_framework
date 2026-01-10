#!/usr/bin/env python3
"""
Dummy script that simulates a CLI tool waiting for user input.
Used for integration testing the TerminalService idle detection.
"""
import time
import sys

# Print working indicator that matches SHELL_WORKING_PATTERNS
print("Working...", flush=True)
time.sleep(0.5)

# Print a prompt that matches SHELL_IDLE_INDICATORS (ends with > )
print("Do you want to proceed?", flush=True)
print("> ", end="", flush=True)

# Script hangs here reading stdin (simulates waiting for input)
try:
    line = input()
    print(f"Got input: {line}", flush=True)
except EOFError:
    pass
