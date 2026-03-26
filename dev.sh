#!/usr/bin/env bash
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

cd /home/runner/workspace/scraper-service && node server.js &
SCRAPER_PID=$!

cd /home/runner/workspace && npx vite

kill $SCRAPER_PID 2>/dev/null
