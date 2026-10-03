#!/bin/sh
# Runs every test. The browser test needs the "playwright" npm package (global is fine).
set -e
cd "$(dirname "$0")/.."
node tests/logic.test.js
node tests/backend.test.js
NODE_PATH="$(npm root -g)" node tests/app.test.js "$@"
