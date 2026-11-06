#!/usr/bin/env bash
# ==============================================================================
# Kyrpy UI/UX Designer — One-Click Runner (Linux & macOS)
# ==============================================================================
# Usage:
#   ./runner.sh           # Starts server (foreground if interactive, or use commands below)
#   ./runner.sh start     # Start server in background
#   ./runner.sh dev       # Start in Dev Mode (bypasses Login/Register page)
#   ./runner.sh release   # Start in Release Mode (protects page with Login/Register)
#   ./runner.sh stop      # Stop background server
#   ./runner.sh restart   # Restart background server
#   ./runner.sh status    # Check server status
#   ./runner.sh logs      # Tail server logs
# ==============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

PORT="${PORT:-5180}"
HOST="${HOST:-127.0.0.1}"
APP_MODE="${APP_MODE:-dev}"
BYPASS_AUTH="${BYPASS_AUTH:-true}"
PID_FILE="$ROOT_DIR/.designer-runner.pid"
LOG_FILE="$ROOT_DIR/designer-runner.log"

CMD="${1:-start}"

start_bg() {
  local mode="${1:-$APP_MODE}"
  local bypass="${2:-$BYPASS_AUTH}"
  stop_bg >/dev/null 2>&1 || true
  echo "🚀 Starting Kyrpy UI/UX Designer on http://${HOST}:${PORT} (APP_MODE=${mode}, BYPASS_AUTH=${bypass})..."
  (
    cd "$ROOT_DIR/src"
    PORT="$PORT" HOST="$HOST" APP_MODE="$mode" BYPASS_AUTH="$bypass" \
      nohup node --disable-warning=ExperimentalWarning main.js serve --port "$PORT" > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
  )
  sleep 1
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "✅ Running (PID $(cat "$PID_FILE")) -> http://${HOST}:${PORT}"
    echo "🔑 Default login credential: username 'admin' / password 'admin'"
  else
    echo "❌ Server failed to start. Check $LOG_FILE"
    exit 1
  fi
}

stop_bg() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      echo "🛑 Stopped Kyrpy UI/UX Designer (PID $pid)"
    fi
    rm -f "$PID_FILE"
  fi
}

case "$CMD" in
  start)
    start_bg "$APP_MODE" "$BYPASS_AUTH"
    ;;
  dev)
    start_bg "dev" "true"
    ;;
  release)
    start_bg "release" "false"
    ;;
  stop)
    stop_bg
    ;;
  restart)
    stop_bg
    start_bg "$APP_MODE" "$BYPASS_AUTH"
    ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "✅ Kyrpy UI/UX Designer is running (PID $(cat "$PID_FILE")) on http://${HOST}:${PORT} (APP_MODE=${APP_MODE})"
    else
      echo "⚪ Kyrpy UI/UX Designer is not running."
    fi
    ;;
  logs)
    tail -f "$LOG_FILE"
    ;;
  *)
    echo "Usage: ./runner.sh {start|dev|release|stop|restart|status|logs}"
    exit 1
    ;;
esac
