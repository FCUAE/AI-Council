#!/bin/bash
set -e

if grep -q 'externalPort = 5000' .replit 2>/dev/null; then
  sed -i 's/externalPort = 5000/externalPort = 80/' .replit
  echo "[post-merge] Fixed externalPort back to 80"
fi

npm install
npm run db:push
