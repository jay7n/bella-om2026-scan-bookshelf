#!/usr/bin/env bash
# 用 tmux 在后台常驻运行扫书服务。断开 SSH / 关掉 IDE 终端后进程仍存活。
#
# 用法：
#   bash scripts/tmux-saoshu.sh <command>
#   command: start | stop | restart | attach | status | logs
#
# npm 快捷方式：npm run tmux:start / tmux:status / tmux:logs …

set -euo pipefail

COMMAND="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="saoshu"
START_CMD="npm run start:production"
LOG_FILE="$ROOT/tmp/tmux-saoshu.log"

usage() {
  cat <<'EOF'
用法: bash scripts/tmux-saoshu.sh <command>

  command   start | stop | restart | attach | status | logs

示例:
  npm run tmux:start
  npm run tmux:status
  npm run tmux:logs
EOF
}

require_tmux() {
  if command -v tmux >/dev/null 2>&1; then
    return 0
  fi
  echo "未检测到 tmux。请先安装："
  if [[ "$(uname -s)" == "Darwin" ]]; then
    echo "  brew install tmux"
  else
    echo "  sudo apt update && sudo apt install -y tmux"
    echo "  （Debian/Ubuntu。若是 alpine：apk add tmux）"
  fi
  exit 1
}

session_running() {
  tmux has-session -t "$SESSION" 2>/dev/null
}

cmd_start() {
  if session_running; then
    echo "tmux 会话已在运行: $SESSION"
    echo "  查看状态: npm run tmux:status"
    echo "  进入会话: npm run tmux:attach"
    exit 0
  fi

  if [ ! -f "$ROOT/.next/BUILD_ID" ]; then
    echo "⚠️  没有构建产物。先跑一次："
    echo "   pnpm install && pnpm build"
    exit 1
  fi

  mkdir -p "$(dirname "$LOG_FILE")"
  echo "启动 tmux 会话: $SESSION"
  echo "  命令: $START_CMD"
  echo "  日志: $LOG_FILE"

  # login shell 会加载 ~/.bashrc / ~/.profile，便于 nvm；再显式 nvm use 22
  local inner_cmd
  inner_cmd="cd \"$ROOT\""
  inner_cmd+=" && { source \"\${NVM_DIR:-\$HOME/.nvm}/nvm.sh\" 2>/dev/null && nvm use 22; } || true"
  inner_cmd+=" && exec $START_CMD 2>&1 | tee -a \"$LOG_FILE\""

  tmux new-session -d -s "$SESSION" -c "$ROOT" "bash -lc $(printf '%q' "$inner_cmd")"

  sleep 2
  if session_running; then
    echo "✅ 已启动。断开终端后服务仍会继续运行。"
    echo "  进入查看: npm run tmux:attach"
    echo "  脱离会话: Ctrl+b 然后按 d"
  else
    echo "❌ 启动失败，请检查日志: $LOG_FILE"
    exit 1
  fi
}

cmd_stop() {
  if ! session_running; then
    echo "tmux 会话未运行: $SESSION"
    exit 0
  fi
  tmux kill-session -t "$SESSION"
  echo "✅ 已停止: $SESSION"
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_attach() {
  if ! session_running; then
    echo "tmux 会话未运行: $SESSION"
    echo "  先执行: npm run tmux:start"
    exit 1
  fi
  echo "进入会话 $SESSION（脱离: Ctrl+b 然后按 d）"
  exec tmux attach -t "$SESSION"
}

cmd_status() {
  if session_running; then
    echo "✅ 运行中: $SESSION"
    tmux list-sessions 2>/dev/null | grep -F "$SESSION" | sed 's/^/  /' || true
    echo "  日志: $LOG_FILE"
    echo "  探活: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/scan 2>/dev/null || echo '无响应')"
  else
    echo "⏹ 未运行: $SESSION"
  fi
}

cmd_logs() {
  if [[ ! -f "$LOG_FILE" ]]; then
    echo "日志文件尚不存在: $LOG_FILE"
    if session_running; then
      echo "会话在运行但尚无输出，稍后再试。"
    else
      echo "先执行: npm run tmux:start"
    fi
    exit 1
  fi
  echo "跟踪日志: $LOG_FILE（Ctrl+C 退出）"
  tail -n 100 -f "$LOG_FILE"
}

require_tmux

case "$COMMAND" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_restart ;;
  attach) cmd_attach ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  *) usage; exit 1 ;;
esac
