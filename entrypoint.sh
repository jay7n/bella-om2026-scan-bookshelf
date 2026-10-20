#!/bin/bash
set -e

cd /home/devbox/project

# 优先用 nvm 切到 Node 22 再启动（Next 16 要求 Node ≥ 20.9，Node 18 会因为 SWC 加载失败起不来）；失败则兜底为当前环境的 Node。
echo "Starting Next.js server..."

# 没构建过就提前说清楚，否则只会看到 next start 的一句含糊报错
if [ ! -f .next/BUILD_ID ]; then
  echo "WARN: 没找到 .next/BUILD_ID，说明还没构建。先执行一次：pnpm install && pnpm build" >&2
fi

(
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    exit 1
  fi
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  nvm use 22 && npm run start:production
) || {
  echo "WARN: nvm use 22 && npm run start:production 未成功（例如未安装 nvm、未装 Node 22 或启动报错），改用当前默认 Node 重试: npm run start:production" >&2
  npm run start:production
}
