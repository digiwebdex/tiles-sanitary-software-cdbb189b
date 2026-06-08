#!/usr/bin/env bash
# SaniTiles VPS — diagnose database connection issues
# Run on VPS: bash scripts/vps-db-doctor.sh
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/var/www/tilessaas}"
cd "$PROJECT_DIR"

echo "═══════════════════════════════════════════"
echo "  SaniTiles VPS DB Doctor"
echo "═══════════════════════════════════════════"
echo ""

echo "[1] Checking env files..."
for f in "$PROJECT_DIR/.env" "$PROJECT_DIR/backend/.env"; do
  if [[ -f "$f" ]]; then
    echo "  ✓ Found $f"
    if grep -q '^DB_PASSWORD=' "$f" 2>/dev/null; then
      echo "    DB_PASSWORD: set"
    fi
    if grep -q '^DATABASE_URL=' "$f" 2>/dev/null; then
      echo "    DATABASE_URL: set ($(grep '^DATABASE_URL=' "$f" | sed 's/:\/\/[^:]*:[^@]*@/:\/\/***:***@/'))"
    fi
  else
    echo "  ✗ Missing $f"
  fi
done
echo ""

echo "[2] Checking Postgres listeners..."
for port in 5440 5435 5432; do
  if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
    echo "  ✓ Port $port is listening"
  else
    echo "  · Port $port not listening"
  fi
done
echo ""

echo "[3] Checking Docker Postgres (if used)..."
if command -v docker >/dev/null 2>&1; then
  docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null | grep -iE 'postgres|tileserp|db' || echo "  · No postgres container running"
else
  echo "  · Docker not installed"
fi
echo ""

echo "[4] Running Node DB doctor..."
cd "$PROJECT_DIR/backend"
if [[ -f "$PROJECT_DIR/.env" ]]; then
  set -a && source "$PROJECT_DIR/.env" && set +a
fi
export NODE_ENV=production
npx tsx src/scripts/dbDoctor.ts || true

echo ""
echo "═══════════════════════════════════════════"
echo "  If connection failed, run:"
echo "  bash scripts/vps-fresh-setup.sh"
echo "═══════════════════════════════════════════"
