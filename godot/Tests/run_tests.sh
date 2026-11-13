#!/usr/bin/env bash
# Runs the WebCommands test suite headless. No browser or Web export needed.
#
# Usage:
#   Tests/run_tests.sh
# Override the Godot binary with:
#   GODOT_BIN=/path/to/godot Tests/run_tests.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

GODOT_BIN="${GODOT_BIN:-godot}"

"${GODOT_BIN}" --headless --path "${PROJECT_DIR}" --script Tests/test_web_commands.gd
