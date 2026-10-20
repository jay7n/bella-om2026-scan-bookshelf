# 部署到 Sealos

两种方式，按你在 Sealos 上建的是哪种来选。

## 需要配置的环境变量

无论哪种方式，这几个都要在平台的「环境变量」里配，**不要提交进仓库**：

| 变量 | 必填 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | ✅ | 识别书名 + 写简介 |
| `ARK_API_KEY` | 可选 | Seedream 画封面，不填就只用程序化封面 |
| `ARK_API_BASE` | 可选 | 默认 `https://ark.cn-beijing.volces.com/api/v3` |
| `ARK_IMAGE_MODEL` | 可选 | 默认 `doubao-seedream-4-0-20260415` |
| `DEEPSEEK_BASE_URL` | 可选 | 默认 `https://api.deepseek.com` |
| `DEEPSEEK_THINKING` | 可选 | 默认 `disabled`，别改 |

---

## 方式 A：Devbox（和你 wksp2 那套一样）

代码放在 `/home/devbox/project`，用 Node 直接跑。

```bash
# 1. 进 Devbox 终端，克隆仓库
cd /home/devbox/project
git clone git@github.com:jay7n/bella-om2026-scan-bookshelf.git .

# 2. 配环境变量（这个文件不进仓库）
cat > .env.production <<'EOF'
DEEPSEEK_API_KEY=sk-你的key
ARK_API_KEY=你的火山key
EOF

# 3. 装依赖 + 构建
corepack enable
pnpm install --frozen-lockfile
pnpm build

# 4. 启动
pnpm start:production
```

**启动用仓库里的 `entrypoint.sh`**（和你 wksp2 那套同一个结构：nvm 切 Node 22，失败则兜底）：

```bash
chmod +x entrypoint.sh
./entrypoint.sh
```

它只负责**启动**，不负责装依赖和构建——首次部署要先把上面第 3 步（`pnpm install` + `pnpm build`）跑一遍。
漏了的话脚本会打印一行 `WARN: 没找到 .next/BUILD_ID`，看到这句就回去构建。

想用 PM2 常驻：

```bash
npm i -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 logs saoshu
```

`ecosystem.config.js` 会自动读 `.env.production`。

### 用 tmux 常驻（推荐）

Devbox 的终端一关，前台进程就没了。用 tmux 可以让服务在断开 SSH 后继续跑。

**装 tmux**（Devbox 一般是 Ubuntu）：

```bash
sudo apt update && sudo apt install -y tmux
tmux -V
```

如果是 alpine 镜像：`sudo apk add tmux`。

**用仓库里的脚本启动**：

```bash
pnpm build                 # 先确保构建过
npm run tmux:start         # 后台起一个叫 saoshu 的会话
npm run tmux:status        # 看状态（会顺手探活 3000 端口）
npm run tmux:logs          # 跟踪日志，Ctrl+C 退出
npm run tmux:attach        # 进会话，Ctrl+b 然后按 d 脱离
npm run tmux:restart       # 改完代码 pnpm build 之后重启
npm run tmux:stop          # 停
```

> ⚠️ **tmux 只能扛住 SSH 断开，扛不住容器重启。**
> Devbox 实例重启（休眠、重新部署、平台维护）后 tmux 会话会消失。
> 想让它开机自启，用平台设置里的启动命令指向 `entrypoint.sh`，而不是依赖 tmux。

### Devbox 注意

- **端口填 3000**，并且要对外暴露
- Node 版本要 **≥ 20.9**（Next 16 的要求），Devbox 里 `nvm use 22`
- 如果 `pnpm` 不存在：`npm i -g pnpm`

---

## 方式 B：App Launchpad（容器镜像）

仓库里已经有 `Dockerfile`（多阶段构建，用 standalone 输出，镜像约 200MB）。

```bash
# 在本地构建并推送（Sealos 有内置镜像仓库）
docker build -t saoshu:latest .
docker tag saoshu:latest <你的镜像仓库地址>/saoshu:latest
docker push <你的镜像仓库地址>/saoshu:latest
```

然后在 Sealos 的 App Launchpad：

| 配置项 | 值 |
|---|---|
| 镜像 | 刚推上去的那个 |
| 容器端口 | **3000** |
| 环境变量 | 上面那张表 |
| CPU / 内存 | 0.2 核 / 512MB 足够 |
| 副本数 | 1 |

部署完会给一个 `https://xxx.sealos.run` 的公网域名。

### 镜像注意

- 容器里 `NODE_ENV=production`、`PORT=3000`、`HOSTNAME=0.0.0.0` 已经在 Dockerfile 里设好
- `.cache/covers` 在容器里是**临时目录**，重启就清空。封面缓存会重建，只是第一次慢一点。要持久化就挂个存储卷到 `/app/.cache`
- `.env.local` 不会被打进镜像（`.dockerignore` 里排除了）

---

## 部署后自查

```bash
# 1. 页面能开
curl -I https://你的域名/

# 2. key 读到了（ok:true 才算成功）
curl https://你的域名/api/scan

# 3. 豆瓣代抓通了
curl -o /dev/null -w "%{http_code}\n" \
  "https://你的域名/api/cover?u=https%3A%2F%2Fimg2.doubanio.com%2Fview%2Fsubject%2Fs%2Fpublic%2Fs1067911.jpg"
```

三条都通，就可以在手机上打开用了。

---

## 线上和本地的区别

| | 本地开发 | 线上部署 |
|---|---|---|
| 地址 | `http://<主机名>.local:3000` | `https://xxx.sealos.run` |
| JS 白名单 | 需要 `allowedDevOrigins` | 不需要（只在 dev 生效） |
| API key | `.env.local` | 平台环境变量 |
| 封面缓存 | `.cache/covers` 持久 | 容器内临时，重启清空 |

**线上是 HTTPS，反而比本地更适合演示**——浏览器对 HTTPS 站点更信任，也不会有局域网 IP 变来变去的问题。
