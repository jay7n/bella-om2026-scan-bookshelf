import os from "node:os";

/**
 * 收集本机所有局域网 IPv4。
 *
 * Next 16 的开发服务器默认只允许 localhost 加载 /_next/* 资源，
 * 手机用局域网 IP 访问时 JS 会被 403 挡掉 —— 表现就是
 * 「页面能打开、按钮能点出相册，但选完照片毫无反应」（因为 React 根本没加载）。
 */
function localOrigins() {
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

  // 主机名也放进来：iPhone 可以用 http://<主机名>.local:3000，
  // 这个地址跟着电脑走，路由器重新分配 IP 也不会失效。
  const hn = os.hostname().replace(/\.local$/i, "");
  if (hn) {
    hosts.add(hn);
    hosts.add(`${hn}.local`);
    hosts.add(hn.toLowerCase());
    hosts.add(`${hn.toLowerCase()}.local`);
  }
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) hosts.add(ni.address);
    }
  }
  return [...hosts];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 只有构建 Docker 镜像时才开 standalone（BUILD_STANDALONE=1）。
  // 开了 standalone 之后 `next start` 会拒绝启动，
  // 而 Devbox 上跑的就是 next start —— 所以平时必须关着。
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  // 关键：不加这行，手机访问时 JS 全部 403
  allowedDevOrigins: localOrigins(),
};

export default nextConfig;
