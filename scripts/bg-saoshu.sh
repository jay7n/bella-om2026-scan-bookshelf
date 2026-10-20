#!/usr/bin/env bash
# 不依赖 tmux / pm2 的常驻方案：nohup + pid 文件。
# 断开 SSH、关掉 IDE 终端后进程继续跑。
#
# 用法: bash scripts/bg-saoshu.sh <start|stop|restart|status|logs>

set -euo pipefail

COMMAND="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$ROOT/tmp/saoshu.log"
PID_FILE="$ROOT/tmp/saoshu.pid"
PORT=3000

usage() {
  cat <<'EOF'
用法: bash scripts/bg-saoshu.sh <command>

  start | stop | restart | status | logs
EOF
}

running_pid() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
    rm -f "$PID_FILE"
  fi
  return 1
}

# 尽量切到 Node 22（Devbox 里 node 默认可能是旧的），没有 nvm 就用当前的
pick_node() {
  if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1 || true
    nvm use 22 >/dev/null 2>&1 || true
  fi
  local bin major
  bin="$(command -v node || true)"
  if [ -z "$bin" ]; then
    echo "找不到 node，请先安装 Node 20.9 以上" >&2
    exit 1
  fi
  major="$("$bin" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${major:-0}" -lt 20 ]; then
    echo "Node 版本太低：$("$bin" -v)（Next 16 需要 >= 20.9）" >&2
    echo "  试试：nvm use 22" >&2
    exit 1
  fi
  echo "$bin"
}

cmd_start() {
  local pid
  if pid="$(running_pid)"; then
    echo "已经在跑，PID=$pid"
    echo "  查看状态: npm run bg:status"
    return 0
  fi

  if [ ! -f "$ROOT/.next/BUILD_ID" ]; then
    echo "⚠️  没有构建产物，先跑一次：pnpm install && pnpm build"
    exit 1
  fi

  local node_bin
  node_bin="$(pick_node)"
  echo "使用 Node: $("$node_bin" -v)"

  mkdir -p "$ROOT/tmp"
  # 直接起真正的服务进程（不是 npm），这样 pid 就是服务本身，kill 得干净
  cd "$ROOT"
  nohup "$node_bin" node_modules/next/dist/bin/next start -H 0.0.0.0 -p "$PORT" \
    >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"

  sleep 3
  if pid="$(running_pid)"; then
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/scan" 2>/dev/null || echo 000)"
    echo "✅ 已启动，PID=$pid"
    echo "  探活 /api/scan: $code"
    echo "  日志: $LOG_FILE"
  else
    echo "❌ 启动失败，看日志："
    tail -n 20 "$LOG_FILE" 2>/dev/null || true
    exit 1
  fi
}

cmd_stop() {
  local pid
  if ! pid="$(running_pid)"; then
    echo "没在跑"
    return 0
  fi
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 10); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "✅ 已停止"
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_status() {
  local pid
  if pid="$(running_pid)"; then
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/scan" 2>/dev/null || echo 000)"
    echo "✅ 运行中，PID=$pid，/api/scan = $code"
    echo "  日志: $LOG_FILE"
  else
    echo "⏹ 未运行"
  fi
}

cmd_logs() {
  if [ ! -f "$LOG_FILE" ]; then
    echo "还没有日志: $LOG_FILE"
    exit 1
  fi
  echo "跟踪日志: $LOG_FILE（Ctrl+C 退出）"
  tail -n 100 -f "$LOG_FILE"
}

case "$COMMAND" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_restart ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  *) usage; exit 1 ;;
esac
