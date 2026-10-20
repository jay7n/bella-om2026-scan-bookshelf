#!/bin/bash
# Sealos Devbox 启动脚本
set -e

cd "$(dirname "$0")"

echo "[entrypoint] 检查依赖…"
if [ ! -d node_modules ]; then
  echo "[entrypoint] 首次安装依赖（可能要几分钟）"
  corepack enable || true
  pnpm install --frozen-lockfile
fi

echo "[entrypoint] 检查构建产物…"
if [ ! -f .next/BUILD_ID ]; then
  echo "[entrypoint] 首次构建"
  pnpm build
fi

echo "[entrypoint] 启动服务"
exec pnpm start:production
