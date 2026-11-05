#!/usr/bin/env bash
###############################################################################
# Kyrpy UI/UX Designer — One-Click Local Installer & Launcher
#
# Usage:
#   ./install.sh                  # Interactive setup (.env prompt) + start server
#   ./install.sh --local-only     # Non-interactive local SQLite setup + start server
#   ./install.sh --test-only      # Configure + run automated test suite (67 tests)
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BOLD="\033[1m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

MODE="interactive"
RUN_TESTS_ONLY="false"
NO_START="false"

for arg in "$@"; do
  case "$arg" in
    --local-only|--non-interactive|-y)
      MODE="local-only"
      ;;
    --test-only)
      MODE="local-only"
      RUN_TESTS_ONLY="true"
      ;;
    --no-start)
      NO_START="true"
      ;;
    --help|-h)
      echo "Usage: ./install.sh [--local-only] [--test-only] [--no-start]"
      exit 0
      ;;
  esac
done

echo -e "${CYAN}${BOLD}======================================================================${RESET}"
echo -e "${CYAN}${BOLD}   ◈ Kyrpy UI/UX App Designer — One-Click Local Installer & Runner    ${RESET}"
echo -e "${CYAN}${BOLD}======================================================================${RESET}"
echo ""

# -----------------------------------------------------------------------------
# 1. Verify Node.js runtime (v22+ required for built-in node:sqlite, zero npm deps)
# -----------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}✖ Node.js is not installed.${RESET}"
  echo "Please install Node.js v22 or newer (https://nodejs.org or via nvm: 'nvm install 22') and re-run ./install.sh"
  exit 1
fi

NODE_VER="$(node -v)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo -e "${RED}✖ Node.js v22+ is required (found ${NODE_VER}).${RESET}"
  echo "Kyrpy UI/UX Designer uses Node's built-in 'node:sqlite' with zero external npm dependencies."
  echo "Upgrade with: nvm install 22 && nvm use 22"
  exit 1
fi
echo -e "${GREEN}✔ Node.js runtime verified:${RESET} ${NODE_VER} (zero external npm packages needed)"

# -----------------------------------------------------------------------------
# 2. Interactive .env Configuration for Server-Side PostgreSQL or Local-Only Mode
# -----------------------------------------------------------------------------
ENV_FILE="$SCRIPT_DIR/.env"
APP_PORT=5180
PG_HOST=""
PG_PORT="5432"
PG_USER="postgres"
PG_PASSWORD=""
PG_DATABASE="kyrpy-uiux-designer-db"
PG_ADMIN_DB="postgres"
PG_SYNC_ENABLED="false"
LOCAL_ONLY="true"

if [[ "$MODE" == "interactive" && -t 0 ]]; then
  echo ""
  echo -e "${BOLD}--- Step 1: Server & PostgreSQL Sync Configuration (.env) ---${RESET}"
  echo "This project is Offline-First: all data is stored locally in SQLite (src/data/designer.db)"
  echo "and can optionally synchronize with a server-side PostgreSQL database."
  echo "Leave the PostgreSQL Host empty (press Enter) to run 100% locally on your machine."
  echo ""

  read -r -p "Local HTTP Server Port [5180]: " INPUT_PORT || true
  APP_PORT="${INPUT_PORT:-5180}"

  read -r -p "PostgreSQL Host (PGHOST) [press Enter for Local-Only mode]: " INPUT_PGHOST || true
  PG_HOST="$(echo "${INPUT_PGHOST:-}" | xargs)"

  if [[ -n "$PG_HOST" ]]; then
    read -r -p "PostgreSQL Port (PGPORT) [5432]: " INPUT_PGPORT || true
    PG_PORT="${INPUT_PGPORT:-5432}"

    read -r -p "PostgreSQL User (PGUSER) [postgres]: " INPUT_PGUSER || true
    PG_USER="${INPUT_PGUSER:-postgres}"

    read -r -s -p "PostgreSQL Password (PGPASSWORD): " INPUT_PGPASS || true
    echo ""
    PG_PASSWORD="${INPUT_PGPASS:-}"

    read -r -p "PostgreSQL Database Name (PGDATABASE) [kyrpy-uiux-designer-db]: " INPUT_PGDB || true
    PG_DATABASE="${INPUT_PGDB:-kyrpy-uiux-designer-db}"

    read -r -p "PostgreSQL Admin DB for auto-creation (PGADMINDB) [postgres]: " INPUT_PGADMIN || true
    PG_ADMIN_DB="${INPUT_PGADMIN:-postgres}"

    echo ""
    echo -e "${CYAN}Testing connection to PostgreSQL at ${PG_HOST}:${PG_PORT}...${RESET}"
    PG_REACHABLE="false"

    if command -v psql >/dev/null 2>&1; then
      if PGPASSWORD="$PG_PASSWORD" PGCONNECT_TIMEOUT=4 psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_ADMIN_DB" -c "SELECT 1;" >/dev/null 2>&1 || \
         PGPASSWORD="$PG_PASSWORD" PGCONNECT_TIMEOUT=4 psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -c "SELECT 1;" >/dev/null 2>&1; then
        PG_REACHABLE="true"
      fi
    elif timeout 3 bash -c "cat < /dev/null > /dev/tcp/${PG_HOST}/${PG_PORT}" 2>/dev/null; then
      PG_REACHABLE="true"
    fi

    if [[ "$PG_REACHABLE" == "true" ]]; then
      echo -e "${GREEN}✔ PostgreSQL connection succeeded (${PG_HOST}:${PG_PORT})! Enabling bi-directional PostgreSQL sync.${RESET}"
      PG_SYNC_ENABLED="true"
      LOCAL_ONLY="false"
    else
      echo -e "${YELLOW}⚠ Could not connect to PostgreSQL at ${PG_HOST}:${PG_PORT}.${RESET}"
      echo -e "${YELLOW}  -> Switching to Local-Only SQLite Mode so the app works immediately on your local machine.${RESET}"
      echo -e "${YELLOW}  -> Your credentials are saved in .env; you can enable sync anytime from the topbar '⇅ PG Sync' menu.${RESET}"
      PG_SYNC_ENABLED="false"
      LOCAL_ONLY="true"
    fi
  else
    echo -e "${GREEN}✔ No PostgreSQL host entered — configuring 100% Local-Only SQLite Mode.${RESET}"
    PG_SYNC_ENABLED="false"
    LOCAL_ONLY="true"
  fi

  cat > "$ENV_FILE" <<EOF
# Generated by ./install.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
export PORT="${APP_PORT}"
export SERVICE_PORT="${APP_PORT}"
export PG_SYNC_ENABLED="${PG_SYNC_ENABLED}"
export LOCAL_ONLY="${LOCAL_ONLY}"
export PGHOST="${PG_HOST}"
export PGPORT="${PG_PORT}"
export PGUSER="${PG_USER}"
export PGPASSWORD="${PG_PASSWORD}"
export PGDATABASE="${PG_DATABASE}"
export PGADMINDB="${PG_ADMIN_DB}"
EOF
  chmod 600 "$ENV_FILE"
  echo -e "${GREEN}✔ Saved configuration to ${ENV_FILE} (mode 0600, gitignored)${RESET}"
else
  if [[ ! -f "$ENV_FILE" && ! -f "$SCRIPT_DIR/credentials.env" ]]; then
    cat > "$ENV_FILE" <<EOF
# Generated by ./install.sh (--local-only) on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
export PORT="${APP_PORT}"
export SERVICE_PORT="${APP_PORT}"
export PG_SYNC_ENABLED="false"
export LOCAL_ONLY="true"
export PGHOST=""
export PGPORT="5432"
export PGUSER="postgres"
export PGPASSWORD=""
export PGDATABASE="kyrpy-uiux-designer-db"
export PGADMINDB="postgres"
EOF
    chmod 600 "$ENV_FILE"
    echo -e "${GREEN}✔ Created local-only .env configuration (${ENV_FILE})${RESET}"
  else
    echo -e "${GREEN}✔ Existing environment configuration detected.${RESET}"
  fi
fi

# -----------------------------------------------------------------------------
# 3. Verify or Seed Sample SQLite Database (src/data/designer.db)
# -----------------------------------------------------------------------------
echo ""
echo -e "${BOLD}--- Step 2: Sample SQLite Database Verification ---${RESET}"
mkdir -p "$SCRIPT_DIR/src/data" "$SCRIPT_DIR/logs"

if [[ ! -f "$SCRIPT_DIR/src/data/designer.db" ]]; then
  echo -e "${CYAN}Initializing local SQLite database from sql/sample_data_sqlite.sql...${RESET}"
  node --disable-warning=ExperimentalWarning -e '
    import { readFileSync } from "node:fs";
    import { openDatabase } from "./src/infrastructure/sqlite/database.js";
    const db = openDatabase("./src/data/designer.db");
    const sql = readFileSync("./sql/sample_data_sqlite.sql", "utf8");
    db.exec(sql);
    db.close();
  '
fi

DB_SUMMARY="$(node --disable-warning=ExperimentalWarning -e '
  import { openDatabase } from "./src/infrastructure/sqlite/database.js";
  const db = openDatabase("./src/data/designer.db");
  const counts = ["paths","icons","buttons","elements","screens","workflows","themes"].map(
    t => `${db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n} ${t}`
  ).join(", ");
  console.log(counts);
  db.close();
')"
echo -e "${GREEN}✔ Local SQLite sample database ready:${RESET} ${DB_SUMMARY}"

# -----------------------------------------------------------------------------
# 4. Optional Test Run or Start Local Server
# -----------------------------------------------------------------------------
if [[ "$RUN_TESTS_ONLY" == "true" ]]; then
  echo ""
  echo -e "${BOLD}--- Running Automated Test Suite ---${RESET}"
  (cd "$SCRIPT_DIR/src" && npm test)
  exit 0
fi

if [[ "$NO_START" == "true" ]]; then
  echo ""
  echo -e "${GREEN}${BOLD}✔ Installation complete! Start anytime with: ./run.sh start${RESET}"
  exit 0
fi

echo ""
echo -e "${BOLD}--- Step 3: Starting Kyrpy UI/UX Designer Server ---${RESET}"
if [[ -x "$SCRIPT_DIR/run.sh" ]]; then
  "$SCRIPT_DIR/run.sh" restart
else
  nohup node --disable-warning=ExperimentalWarning src/main.js serve --port "$APP_PORT" > "$SCRIPT_DIR/logs/app.log" 2>&1 &
  echo $! > "$SCRIPT_DIR/logs/app.pid"
  sleep 1
fi

echo ""
echo -e "${GREEN}${BOLD}======================================================================${RESET}"
echo -e "${GREEN}${BOLD}  🚀 Kyrpy UI/UX Designer is running!${RESET}"
echo -e "  • Local URL:        ${CYAN}http://127.0.0.1:${APP_PORT}${RESET}"
echo -e "  • Default Admin:    ${BOLD}kyrpy${RESET}  (password: ${BOLD}kyrpy${RESET})"
echo -e "  • Database Mode:    $( [[ "$PG_SYNC_ENABLED" == "true" ]] && echo "Offline-First SQLite + PostgreSQL Sync (${PG_HOST}:${PG_PORT})" || echo "Local-Only Offline-First SQLite (src/data/designer.db)" )"
echo -e "  • Manage Server:    ${CYAN}./run.sh {status|restart|stop|logs}${RESET}"
echo -e "${GREEN}${BOLD}======================================================================${RESET}"
