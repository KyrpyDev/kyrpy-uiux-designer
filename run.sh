#!/bin/bash
###############################################################################
# APPLICATION RUNNER SCRIPT
# Service: kyrpy-uiux-designer
# Subdomain: designer, uiux
# Type: Local Shell-based
# Managed by kyrpy-wsm (dev.kyrpy.kyrpy.com)
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/config.env" ]]; then
  source "$SCRIPT_DIR/config.env"
fi

SERVICE_NAME="${SERVICE_NAME:-kyrpy-uiux-designer}"
SERVICE_PORT="${SERVICE_PORT:-5180}"
SERVICE_SUBDOMAIN="${SERVICE_SUBDOMAIN:-designer}"
STARTUP_CMD="${STARTUP_CMD:-node --disable-warning=ExperimentalWarning src/main.js serve --port 5180}"
LOG_FILE="${LOG_FILE:-$SCRIPT_DIR/logs/app.log}"
PID_FILE="${PID_FILE:-$SCRIPT_DIR/logs/app.pid}"

# Resolve relative paths against SCRIPT_DIR
if [[ "$LOG_FILE" != /* ]]; then
  LOG_FILE="$SCRIPT_DIR/$LOG_FILE"
fi
if [[ "$PID_FILE" != /* ]]; then
  PID_FILE="$SCRIPT_DIR/$PID_FILE"
fi

mkdir -p "${LOG_FILE%/*}" "${PID_FILE%/*}"

###############################################################################
# UTILITY FUNCTIONS
###############################################################################

log() {
  local level=$1; shift
  local msg="$*"
  local ts=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$ts] [$level] $msg" | tee -a "$LOG_FILE"
}

get_pid() {
  if [[ -f "$PID_FILE" ]]; then
    cat "$PID_FILE"
  else
    echo ""
  fi
}

is_running() {
  local pid=$(get_pid)
  if [[ -z "$pid" ]]; then
    return 1
  fi
  kill -0 "$pid" 2>/dev/null || return 1
}

allow_port() {
  if [[ -n "${SERVICE_PORT:-}" ]]; then
    log "INFO" "Allowing traffic on port $SERVICE_PORT via firewall..."
    if command -v ufw >/dev/null 2>&1; then
      sudo ufw delete deny "$SERVICE_PORT/tcp" >/dev/null 2>&1 || true
      sudo ufw allow "$SERVICE_PORT/tcp" >/dev/null 2>&1 || true
    elif command -v iptables >/dev/null 2>&1; then
      sudo iptables -D INPUT -p tcp --dport "$SERVICE_PORT" -j REJECT >/dev/null 2>&1 || true
      sudo iptables -I INPUT -p tcp --dport "$SERVICE_PORT" -j ACCEPT >/dev/null 2>&1 || true
    fi
  fi
}

protect_port() {
  if [[ -n "${SERVICE_PORT:-}" ]]; then
    log "INFO" "Protecting port $SERVICE_PORT via firewall..."
    if command -v ufw >/dev/null 2>&1; then
      sudo ufw delete allow "$SERVICE_PORT/tcp" >/dev/null 2>&1 || true
      sudo ufw deny "$SERVICE_PORT/tcp" >/dev/null 2>&1 || true
    elif command -v iptables >/dev/null 2>&1; then
      sudo iptables -D INPUT -p tcp --dport "$SERVICE_PORT" -j ACCEPT >/dev/null 2>&1 || true
      sudo iptables -I INPUT -p tcp --dport "$SERVICE_PORT" -j REJECT >/dev/null 2>&1 || true
    fi
  fi
}

check_port_available() {
  local port="$1"
  local occupying_pids=""
  if command -v lsof >/dev/null 2>&1; then
    occupying_pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  fi

  if [[ -n "$occupying_pids" ]]; then
    local current_tracked_pid=$(get_pid)
    for pid in $occupying_pids; do
      if [[ "$pid" != "$current_tracked_pid" ]]; then
        log "WARN" "Port $port occupied by PID $pid. Cleaning up..."
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
  fi
}

###############################################################################
# COMMANDS
###############################################################################

cmd_start() {
  if is_running; then
    log "WARN" "Already running (PID: $(get_pid))"
    return 0
  fi

  log "INFO" "Starting $SERVICE_NAME on port $SERVICE_PORT (subdomains: designer, uiux)..."
  check_port_available "$SERVICE_PORT"
  allow_port

  cd "$SCRIPT_DIR"

  setsid nohup bash -c "
    eval \"\$STARTUP_CMD\" >> '$LOG_FILE' 2>&1 &
    APP_PID=\$!
    echo \"\$APP_PID\" > '$PID_FILE'
    wait \"\$APP_PID\"
  " < /dev/null > /dev/null 2>&1 &

  sleep 2
  if ! is_running; then
    log "ERROR" "Process exited immediately - check logs"
    protect_port
    return 1
  fi

  log "INFO" "✅ Service started successfully (PID: $(get_pid))"
  log "INFO" "🌐 Reachable at: https://${SERVICE_SUBDOMAIN}.dev.kyrpy.kyrpy.com and https://uiux.kyrpy.kyrpy.com"
  return 0
}

cmd_stop() {
  if ! is_running; then
    log "WARN" "Not running"
    protect_port
    return 0
  fi

  log "INFO" "Stopping $SERVICE_NAME..."
  local pid=$(get_pid)

  if [[ -n "$pid" ]]; then
    kill -- -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true

    local count=0
    while kill -0 "$pid" 2>/dev/null && [[ $count -lt 10 ]]; do
      sleep 1
      count=$((count + 1))
    done

    if kill -0 "$pid" 2>/dev/null; then
      log "WARN" "Force killing PID $pid..."
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi

  lsof -ti :"$SERVICE_PORT" | xargs -r kill -9 2>/dev/null || true

  rm -f "$PID_FILE"
  protect_port
  log "INFO" "✅ Service stopped"
  return 0
}

cmd_restart() {
  log "INFO" "Restarting $SERVICE_NAME..."
  cmd_stop || true
  sleep 2
  cmd_start
}

cmd_kill() {
  log "WARN" "Force killing $SERVICE_NAME..."
  local pid=$(get_pid)
  if [[ -n "$pid" ]]; then
    kill -- -"$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
  lsof -ti :"$SERVICE_PORT" | xargs -r kill -9 2>/dev/null || true
  protect_port
  log "INFO" "✅ Killed"
}

cmd_status() {
  if is_running; then
    local pid=$(get_pid)
    log "INFO" "✅ Running (PID: $pid)"
    if netstat -tuln 2>/dev/null | grep -q ":$SERVICE_PORT "; then
      log "INFO" "Port $SERVICE_PORT is listening"
    fi
  else
    log "INFO" "❌ Stopped"
  fi
}

cmd_logs() {
  if [[ ! -f "$LOG_FILE" ]]; then
    log "WARN" "No logs yet"
    return 1
  fi
  log "INFO" "Streaming logs (Ctrl+C to stop)..."
  tail -f "$LOG_FILE"
}

cmd_install() {
  local service_file="/etc/systemd/system/${SERVICE_NAME}.service"
  log "INFO" "Installing systemd service: ${SERVICE_NAME}.service"

  cat <<EOF | sudo tee "$service_file" > /dev/null
[Unit]
Description=$SERVICE_NAME - Managed by kyrpy-wsm
After=network.target

[Service]
Type=simple
WorkingDirectory=$SCRIPT_DIR
ExecStart=$SCRIPT_DIR/run.sh start
ExecStop=$SCRIPT_DIR/run.sh stop
Restart=on-failure
RestartSec=10
User=${SYSTEMD_USER:-nobody}
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable "${SERVICE_NAME}.service"
  log "INFO" "✅ Service installed"
}

cmd_remove() {
  local service_name="${SERVICE_NAME}.service"
  log "INFO" "Removing systemd service: $service_name"
  sudo systemctl disable "$service_name" 2>/dev/null || true
  sudo systemctl stop "$service_name" 2>/dev/null || true
  sudo rm -f "/etc/systemd/system/$service_name"
  sudo systemctl daemon-reload
  log "INFO" "✅ Service removed"
}

cmd_health() {
  log "INFO" "Running health check on port $SERVICE_PORT..."
  if timeout 2 bash -c "cat < /dev/null > /dev/tcp/127.0.0.1/$SERVICE_PORT" 2>/dev/null; then
    log "INFO" "✅ Service is healthy"
    return 0
  else
    log "WARN" "❌ Service not responding on port $SERVICE_PORT"
    return 1
  fi
}

main() {
  local action="${1:-status}"
  case "$action" in
    start)      cmd_start ;;
    stop)       cmd_stop ;;
    restart)    cmd_restart ;;
    kill)       cmd_kill ;;
    status)     cmd_status ;;
    logs)       cmd_logs ;;
    install)    cmd_install ;;
    remove)     cmd_remove ;;
    health)     cmd_health ;;
    *)
      echo "Usage: $0 {start|stop|restart|kill|status|logs|install|remove|health}"
      exit 1
      ;;
  esac
}

main "$@"
