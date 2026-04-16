#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="frontend"
BUILD_ID_FILE="$SCRIPT_DIR/.next/BUILD_ID"
PM2_CONFIG="$SCRIPT_DIR/ecosystem.config.js"

if [[ ! -s "$BUILD_ID_FILE" ]]; then
  echo "ERROR: build integrity check failed: missing or empty $BUILD_ID_FILE" >&2
  echo "Aborting deploy before PM2 restart." >&2
  exit 1
fi

cd "$SCRIPT_DIR"

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_CONFIG" --only "$APP_NAME" --env production --update-env
else
  pm2 start "$PM2_CONFIG" --only "$APP_NAME" --env production --update-env
fi
