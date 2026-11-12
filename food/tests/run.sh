#!/bin/sh
# Runs every food log test. From the repo root: sh food/tests/run.sh
# The app test needs: npm i playwright-core, and CHROMIUM_PATH pointing to Chrome or Chromium.
set -e
cd "$(dirname "$0")"
node logic.test.js
node app.test.js
