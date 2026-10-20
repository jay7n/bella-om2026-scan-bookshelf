/**
 * PM2 配置（Sealos Devbox 用）。
 * 环境变量从 .env.production 读，不进仓库。
 */
const fs = require("fs");
const path = require("path");

const envPath = path.resolve(process.cwd(), ".env.production");
const envConfig = {};

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!m || !m[1] || m[1].startsWith("#")) continue;
    envConfig[m[1]] = (m[2] || "").replace(/(^['"]|['"]$)/g, "");
  }
} else {
  console.warn("[pm2] 没找到 .env.production，将只使用系统环境变量");
}

module.exports = {
  apps: [
    {
      name: "saoshu",
      script: "node_modules/next/dist/bin/next",
      args: "start -H 0.0.0.0 -p 3000",
      cwd: __dirname,
      env: { NODE_ENV: "production", ...envConfig },
      max_memory_restart: "512M",
    },
  ],
};
