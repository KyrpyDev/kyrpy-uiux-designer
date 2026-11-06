#!/usr/bin/env bash
# ==============================================================================
# Kyrpy UI/UX Designer — One-Click Local Installer (Linux & macOS)
# ==============================================================================
# - Checks Node.js >= 22 (built-in node:sqlite, zero external runtime deps)
# - Prompts for Dev Mode (bypass login/register) vs Release Mode (protected by login/register)
# - Prompts for optional PostgreSQL .env credentials (falls back to Local-Only SQLite)
# - Seeds default startup installer account: username `admin` / password `admin`
# - Runs verification test suite & launches the studio via ./runner.sh
# ==============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()   { echo -e "${RED}[ERR]${NC}  $*" >&2; }

NON_INTERACTIVE=0
START_SERVER=1

for arg in "$@"; do
  case "$arg" in
    --non-interactive|-y) NON_INTERACTIVE=1 ;;
    --no-start) START_SERVER=0 ;;
  esac
done

echo ""
echo "======================================================================"
echo "  🎨 Kyrpy UI/UX App Designer — One-Click Local Installer"
echo "======================================================================"
echo ""

# 1. Verify Node.js >= 22
if ! command -v node >/dev/null 2>&1; then
  err "Node.js is not installed. Please install Node.js v22 or newer (https://nodejs.org)."
  exit 1
fi

NODE_VER="$(node -v | sed 's/^v//')"
NODE_MAJOR="${NODE_VER%%.*}"
if [ "$NODE_MAJOR" -lt 22 ]; then
  err "Node.js v22+ is required (found v${NODE_VER}) because Kyrpy UI/UX Designer uses built-in node:sqlite."
  exit 1
fi
ok "Detected Node.js v${NODE_VER}"

# 2. Configure .env (Dev vs Release Mode + Optional PostgreSQL Connection)
ENV_FILE="$ROOT_DIR/.env"
PORT="${PORT:-5180}"
HOST="${HOST:-127.0.0.1}"
APP_MODE="dev"
BYPASS_AUTH="true"
PG_SYNC_ENABLED="false"
LOCAL_ONLY="true"
PG_HOST=""
PG_PORT="5432"
PG_USER="postgres"
PG_PASSWORD=""
PG_DATABASE="kyrpy-uiux-designer-db"
PG_ADMIN_DB="postgres"
PG_SCHEMA="public"
PG_SSL="false"

if [ -f "$ENV_FILE" ] && [ "$NON_INTERACTIVE" -eq 1 ]; then
  info "Existing .env found; keeping current configuration."
else
  if [ "$NON_INTERACTIVE" -eq 0 ] && [ -t 0 ]; then
    echo "----------------------------------------------------------------------"
    echo "  🔐 Runtime Mode (Dev vs Release)"
    echo "     - dev     : Bypasses Login/Register page for instant local design"
    echo "     - release : Protects studio with Login/Register page (admin / admin)"
    echo "----------------------------------------------------------------------"
    read -r -p "Select runtime mode [dev/release] (default: dev): " INPUT_MODE
    INPUT_MODE="$(echo "${INPUT_MODE:-dev}" | tr '[:upper:]' '[:lower:]')"
    if [ "$INPUT_MODE" = "release" ]; then
      APP_MODE="release"
      BYPASS_AUTH="false"
    else
      APP_MODE="dev"
      BYPASS_AUTH="true"
    fi

    echo ""
    echo "----------------------------------------------------------------------"
    echo "  🗄️  Database & Server-Side PostgreSQL Setup (.env)"
    echo "  By default, Kyrpy UI/UX Designer works 100% locally with the bundled"
    echo "  SQLite sample database (src/data/designer.db)."
    echo "  Enter server-side PostgreSQL credentials below, or press Enter to"
    echo "  run strictly on your local machine (Local-Only SQLite mode)."
    echo "----------------------------------------------------------------------"
    read -r -p "Local HTTP port [5180]: " INPUT_PORT
    PORT="${INPUT_PORT:-5180}"

    read -r -p "Configure server-side PostgreSQL connection? [y/N]: " WANT_PG
    if [[ "${WANT_PG:-N}" =~ ^[Yy]$ ]]; then
      read -r -p "  PGHOST (leave empty for local-only mode): " PG_HOST
      if [ -n "$PG_HOST" ]; then
        read -r -p "  PGPORT [5432]: " INPUT_PG_PORT
        PG_PORT="${INPUT_PG_PORT:-5432}"
        read -r -p "  PGUSER [postgres]: " INPUT_PG_USER
        PG_USER="${INPUT_PG_USER:-postgres}"
        read -r -s -p "  PGPASSWORD: " PG_PASSWORD
        echo ""
        read -r -p "  PGDATABASE [kyrpy-uiux-designer-db]: " INPUT_PG_DB
        PG_DATABASE="${INPUT_PG_DB:-kyrpy-uiux-designer-db}"
        read -r -p "  PGADMINDB [postgres]: " INPUT_PG_ADMIN
        PG_ADMIN_DB="${INPUT_PG_ADMIN:-postgres}"
        read -r -p "  Enable SSL (PG_SSL)? [y/N]: " INPUT_PG_SSL
        if [[ "${INPUT_PG_SSL:-N}" =~ ^[Yy]$ ]]; then PG_SSL="true"; fi

        info "Testing connectivity to PostgreSQL at ${PG_HOST}:${PG_PORT}..."
        PG_REACHABLE=0
        if command -v psql >/dev/null 2>&1; then
          if PGPASSWORD="$PG_PASSWORD" PGCONNECT_TIMEOUT=4 psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_ADMIN_DB" -c "SELECT 1;" >/dev/null 2>&1 || \
             PGPASSWORD="$PG_PASSWORD" PGCONNECT_TIMEOUT=4 psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -c "SELECT 1;" >/dev/null 2>&1; then
            PG_REACHABLE=1
          fi
        elif node -e "
          const net = require('node:net');
          const s = net.connect({ host: process.argv[1], port: Number(process.argv[2]), timeout: 3000 });
          s.on('connect', () => { s.destroy(); process.exit(0); });
          s.on('error', () => process.exit(1));
          s.on('timeout', () => { s.destroy(); process.exit(1); });
        " "$PG_HOST" "$PG_PORT" 2>/dev/null; then
          PG_REACHABLE=1
        fi

        if [ "$PG_REACHABLE" -eq 1 ]; then
          PG_SYNC_ENABLED="true"
          LOCAL_ONLY="false"
          ok "PostgreSQL server reachable! Bi-directional cloud sync enabled."
        else
          warn "Could not connect to PostgreSQL at ${PG_HOST}:${PG_PORT}. Falling back to Local-Only SQLite mode (PG_SYNC_ENABLED=false, LOCAL_ONLY=true)."
          PG_SYNC_ENABLED="false"
          LOCAL_ONLY="true"
        fi
      else
        info "No PGHOST entered. Using Local-Only SQLite mode."
      fi
    else
      info "Using Local-Only SQLite mode (src/data/designer.db)."
    fi
  fi

  cat > "$ENV_FILE" <<EOF
# Generated by Kyrpy UI/UX Designer installer.sh
PORT=${PORT}
HOST=${HOST}
APP_MODE=${APP_MODE}
BYPASS_AUTH=${BYPASS_AUTH}
DEFAULT_ADMIN_USER=admin
DEFAULT_ADMIN_PASS=admin
PG_SYNC_ENABLED=${PG_SYNC_ENABLED}
LOCAL_ONLY=${LOCAL_ONLY}
PGHOST=${PG_HOST}
PGPORT=${PG_PORT}
PGUSER=${PG_USER}
PGPASSWORD=${PG_PASSWORD}
PGDATABASE=${PG_DATABASE}
PGADMINDB=${PG_ADMIN_DB}
PG_HOST=${PG_HOST}
PG_PORT=${PG_PORT}
PG_USER=${PG_USER}
PG_PASSWORD=${PG_PASSWORD}
PG_DATABASE=${PG_DATABASE}
PG_SCHEMA=${PG_SCHEMA}
PG_SSL=${PG_SSL}
EOF
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  ok "Wrote configuration to .env (APP_MODE=${APP_MODE}, PG_SYNC_ENABLED=${PG_SYNC_ENABLED}, LOCAL_ONLY=${LOCAL_ONLY})"
fi

# 3. Ensure sample SQLite database & default `admin` / `admin` account exist
if [ ! -f "$ROOT_DIR/src/data/designer.db" ] && [ -f "$ROOT_DIR/sql/sample_data_sqlite.sql" ]; then
  info "Initializing local SQLite database from sql/sample_data_sqlite.sql..."
  mkdir -p "$ROOT_DIR/src/data"
  node --input-type=module -e "
    import { readFileSync } from 'node:fs';
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync('./src/data/designer.db');
    db.exec(readFileSync('./sql/sample_data_sqlite.sql', 'utf8'));
    db.close();
  "
  ok "Sample SQLite database initialized at src/data/designer.db"
fi

info "Ensuring default startup account (username: admin / password: admin)..."
(cd "$ROOT_DIR/src" && node --disable-warning=ExperimentalWarning --input-type=module -e "
  import { buildContainer } from './composition-root.js';
  const c = buildContainer({ dbFile: './data/designer.db', syncEnabled: false });
  c.auth.ensureDefaultAdmin();
  c.db.close();
")
ok "Default startup account ready -> Username: admin | Password: admin"

# 4. Run verification test suite
info "Running verification test suite..."
(cd "$ROOT_DIR/src" && npm test)
ok "All automated tests passed!"

# 5. Start the studio server via runner.sh if requested
if [ "$START_SERVER" -eq 1 ]; then
  echo ""
  "$ROOT_DIR/runner.sh" start
fi
