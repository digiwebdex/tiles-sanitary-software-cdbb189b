#!/usr/bin/env bash
# SaniTiles VPS — fresh PostgreSQL + env setup for deployment stage
# Run on VPS as root: bash scripts/vps-fresh-setup.sh
#
# Creates:
#   - PostgreSQL user: tileserp
#   - Database: tileserp
#   - /var/www/tilessaas/.env with DB_PASSWORD
#   - Runs all Knex migrations
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/var/www/tilessaas}"
DB_USER="${DB_USER:-tileserp}"
DB_NAME="${DB_NAME:-tileserp}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5440}"

echo "═══════════════════════════════════════════"
echo "  SaniTiles VPS Fresh Database Setup"
echo "═══════════════════════════════════════════"

cd "$PROJECT_DIR"
git pull origin main || true

# Generate password if not provided
if [[ -z "${DB_PASSWORD:-}" ]]; then
  if [[ -f "$PROJECT_DIR/.env" ]] && grep -q '^DB_PASSWORD=' "$PROJECT_DIR/.env"; then
    DB_PASSWORD=$(grep '^DB_PASSWORD=' "$PROJECT_DIR/.env" | cut -d= -f2-)
  else
    DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
    echo ""
    echo "Generated DB_PASSWORD: $DB_PASSWORD"
    echo "(save this — you will need it for backups)"
  fi
fi

echo ""
echo "[1/6] Starting PostgreSQL..."

USE_DOCKER=false
if command -v docker >/dev/null 2>&1 && [[ -f "$PROJECT_DIR/docker-compose.prod.yml" ]]; then
  USE_DOCKER=true
  export DB_PASSWORD
  # docker-compose.prod maps host 5435 — align with RESOURCE_LOCK 5440 via override
  docker compose -f docker-compose.prod.yml up -d db
  echo "  Waiting for Docker Postgres..."
  sleep 5
  DB_PORT=5435
  DB_HOST=127.0.0.1
fi

if [[ "$USE_DOCKER" == "false" ]]; then
  echo "  Using native PostgreSQL on port $DB_PORT"
  if ! command -v psql >/dev/null 2>&1; then
    echo "Installing PostgreSQL..."
    apt-get update -qq && apt-get install -y postgresql postgresql-contrib
  fi
  systemctl enable postgresql
  systemctl start postgresql

  # Create user + database via postgres superuser socket
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL
fi

echo ""
echo "[2/6] Writing /var/www/tilessaas/.env ..."

# Preserve existing JWT secrets if present
JWT_SECRET="${JWT_SECRET:-}"
JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-}"
if [[ -f "$PROJECT_DIR/.env" ]]; then
  JWT_SECRET="${JWT_SECRET:-$(grep '^JWT_SECRET=' "$PROJECT_DIR/.env" 2>/dev/null | cut -d= -f2- || true)}"
  JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-$(grep '^JWT_REFRESH_SECRET=' "$PROJECT_DIR/.env" 2>/dev/null | cut -d= -f2- || true)}"
fi
[[ -z "$JWT_SECRET" || "$JWT_SECRET" == *"GENERATE"* ]] && JWT_SECRET=$(openssl rand -hex 32)
[[ -z "$JWT_REFRESH_SECRET" || "$JWT_REFRESH_SECRET" == *"GENERATE"* ]] && JWT_REFRESH_SECRET=$(openssl rand -hex 32)

cat > "$PROJECT_DIR/.env" <<ENV
# SaniTiles VPS — auto-generated $(date -Iseconds)
NODE_ENV=production

# Database (canonical — do NOT use postgres superuser)
DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_USER=${DB_USER}
DB_NAME=${DB_NAME}
DB_PASSWORD=${DB_PASSWORD}

# Backend
PORT=3003
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# CORS
CORS_ORIGIN=https://sanitileserp.com,https://www.sanitileserp.com,https://app.sanitileserp.com,https://portal.sanitileserp.com

# Frontend build vars
VITE_AUTH_BACKEND=vps
VITE_VPS_API_BASE=https://api.sanitileserp.com
VITE_DATA_PRODUCTS=vps
ENV

# Remove conflicting backend/.env DATABASE_URL if it points at postgres user
if [[ -f "$PROJECT_DIR/backend/.env" ]]; then
  if grep -q 'postgres://postgres' "$PROJECT_DIR/backend/.env" 2>/dev/null; then
    echo "  Removing bad DATABASE_URL from backend/.env (postgres user)"
    sed -i '/^DATABASE_URL=/d' "$PROJECT_DIR/backend/.env"
  fi
fi

echo ""
echo "[3/6] Installing dependencies..."
npm install --no-audit --no-fund
npm run build
cd backend && npm install --no-audit --no-fund

echo ""
echo "[4/6] Running migrations..."
export NODE_ENV=production
set -a && source "$PROJECT_DIR/.env" && set +a
npx knex migrate:latest --knexfile src/db/knexfile.ts

echo ""
echo "[5/6] Building backend..."
npm run build

echo ""
echo "[6/6] Restarting API..."
if pm2 describe tilessaas-api >/dev/null 2>&1; then
  pm2 restart tilessaas-api
else
  pm2 start dist/index.js --name tilessaas-api
fi
pm2 save

sleep 2
echo ""
curl -s "http://127.0.0.1:3003/api/health" || echo "Health check failed — run: pm2 logs tilessaas-api"

echo ""
echo "═══════════════════════════════════════════"
echo "  Setup complete!"
echo "  DB: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo "  Test: cd backend && npx tsx src/scripts/dbDoctor.ts"
echo "═══════════════════════════════════════════"
