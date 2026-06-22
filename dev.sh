#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"
APPIMAGE="$REPO/Rattin-x86_64.AppImage"
LOG="/tmp/rattin-shell.log"

case "${1:-}" in
  run)
    [ -f "$APPIMAGE" ] || { echo "AppImage not found. Run: $0 build"; exit 1; }
    echo "[dev] launching AppImage..."
    "$APPIMAGE" &
    disown
    echo "[dev] PID: $!"
    ;;

  stop)
    # Kill only the rattin-shell process inside the AppImage mount
    pid=$(pgrep -f "mount_.*rattin-shell" 2>/dev/null | head -1 || true)
    if [ -n "$pid" ]; then
      echo "[dev] stopping PID $pid"
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    # Clean up any leftover node/ffmpeg children
    pkill -f "usr/share/rattin" 2>/dev/null || true
    echo "[dev] stopped"
    ;;

  status)
    if pgrep -f "rattin-shell" >/dev/null 2>&1; then
      echo "[dev] running (pid: $(pgrep -f rattin-shell | head -1))"
    else
      echo "[dev] not running"
    fi
    ;;

  logs)
    [ -f "$LOG" ] && tail -50 "$LOG" || echo "[dev] no logs yet at $LOG"
    ;;

  logs-follow)
    echo "[dev] following $LOG (Ctrl+C to stop)"
    tail -f "$LOG"
    ;;

  build)
    echo "[dev] building AppImage..."
    "$REPO/install/build-appimage.sh" 2>&1 | grep -E '^\[(INFO|WARN|ERROR|SKIP)\]|ready|Output|success'
    ;;

  rebuild)
    "$0" stop 2>/dev/null || true
    sleep 1
    "$0" build
    ;;

  api)
    curl -s "http://localhost:9630${2:-/api/plugins/status}" | python3 -m json.tool 2>/dev/null || curl -s "http://localhost:9630${2:-/api/plugins/status}"
    ;;

  *)
    echo "Usage: $0 {run|stop|status|logs|logs-follow|build|rebuild|api <path>}"
    ;;
esac
