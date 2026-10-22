#!/bin/bash
# Sealos 启动脚本
set -e

# 跟着脚本自己的位置走，项目放在哪个目录都不会 cd 错
cd "$(cd "$(dirname "$0")" && pwd)"

echo "[entrypoint] 目录: $(pwd)"

# 尽量用 Node 22；没有就用当前的，但必须 >= 20.9（Next 16 的要求）
if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1 || true
  nvm use 22 >/dev/null 2>&1 && echo "[entrypoint] 已切到 Node $(node -v)" || true
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[entrypoint] 找不到 node，请先安装 Node 20.9 以上" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  echo "[entrypoint] Node 版本太低：$(node -v)，需要 >= 20.9" >&2
  exit 1
fi
echo "[entrypoint] Node $(node -v)"

# 没构建过就先构建一次
if [ ! -f .next/BUILD_ID ]; then
  echo "[entrypoint] 没有构建产物，先构建（第一次会慢一点）"
  if [ -d node_modules ]; then
    npm run build
  else
    npm install --no-audit --no-fund && npm run build
  fi
fi

echo "[entrypoint] 启动服务"
exec npm run start:production
