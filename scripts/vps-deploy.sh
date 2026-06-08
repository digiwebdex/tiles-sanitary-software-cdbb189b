#!/usr/bin/env bash
# SaniTiles VPS — pull, build backend + frontend, migrate, PM2 restart/start
# Run on VPS: bash scripts/vps-deploy.sh
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/var/www/tilessaas}"
ENV_FILE="${ENV_FILE:-$PROJECT_DIR/.env}"

echo "═══════════════════════════════════════════"
echo "  SaniTiles VPS Deploy"
echo "═══════════════════════════════════════════"

cd "$PROJECT_DIR"

echo ""
echo "[1/7] git pull origin main..."
git pull origin main

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Missing $ENV_FILE — run scripts/vps-fresh-setup.sh first"
  exit 1
fi

echo ""
echo "[2/7] Frontend: npm install + build..."
npm install --no-audit --no-fund
npm run build

echo ""
echo "[3/7] Backend: npm install..."
cd "$PROJECT_DIR/backend"
npm install --no-audit --no-fund

echo ""
echo "[4/7] Load env + run migrations..."
export NODE_ENV=production
set -a && source "$ENV_FILE" && set +a
npx knex migrate:latest --knexfile src/db/knexfile.ts

echo ""
echo "[5/7] Backend: npm run build..."
npm run build

echo ""
echo "[6/7] PM2 restart or first start..."
if pm2 describe tilessaas-api >/dev/null 2>&1; then
  pm2 restart tilessaas-api --update-env
else
  pm2 start dist/index.js --name tilessaas-api --update-env
fi
pm2 save

echo ""
echo "[7/7] Health check..."
sleep 2
HEALTH=$(curl -s "http://127.0.0.1:3003/api/health" || true)
echo "$HEALTH"

if echo "$HEALTH" | grep -q '"database":"connected"'; then
  echo ""
  echo "═══════════════════════════════════════════"
  echo "  Deploy OK"
  echo "  Next: Logout → Login → Ctrl+Shift+R in browser"
  echo "═══════════════════════════════════════════"
else
  echo ""
  echo "WARNING: Health check did not report database connected."
  echo "Run: pm2 logs tilessaas-api --lines 50"
  exit 1
fi
