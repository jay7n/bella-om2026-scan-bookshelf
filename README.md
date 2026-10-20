# 扫书 · AI 书架速览器

拍一张书架照片 → AI 认出书脊上的书名 → 生成「大白话简介 + 标签」的卡片 → 左右滑动挑书。

社区图书角用的挑书小助手：扫一下书架，就知道这排书里该借哪本。手机浏览器打开即用，不用装 App。

---

## 一、跑起来（3 步）

> **⚠️ 先看这条：本项目要 Node 20.9 以上。**
> 这台机器默认的 `node` 是 v18，直接跑会报 `Failed to load SWC binary`。
> 先切到 24：`nvm use 24`（仓库里已经有 `.nvmrc`，直接 `nvm use` 就行）。

```bash
cd bookshelf-scanner
nvm use              # 切到 Node 24（读同目录的 .nvmrc）
npm install          # 或 pnpm install
npm run dev
```

浏览器打开 **http://localhost:3000**

手机上体验：手机和电脑连同一个 WiFi，在手机浏览器输入
`http://<电脑的局域网 IP>:3000`（Mac 上用 `ipconfig getifaddr en0` 查 IP）。

### 填 API Key

打开 `bookshelf-scanner/.env.local`，把 key 填在等号右边（不要加引号）：

```
DEEPSEEK_API_KEY=sk-你的key
```

**改完必须重启 `npm run dev`**，Next.js 才会读到新值。

---

## 二、它是怎么工作的

```
手机拍照
  └─ 本地压缩到长边 1536 / JPEG 0.72（约 150~250KB）
      └─ POST /api/scan  （二进制上传，比 base64 小 1/3）
           └─ DeepSeek 视觉模型：流式吐书名，一行一本
                ├─ 收到第一个书名 → 立刻 /api/search 查豆瓣封面
                ├─ 同时          → /api/enrich 写简介和标签
                └─ 卡片先出来，文案后填（渐进渲染）
```

关键设计：**不等奖全部识别完才出画面**。第一个书名到了就开始查封面，所以第一张卡 3~5 秒就能看见。

### 接口一览

| 接口 | 作用 | 说明 |
|---|---|---|
| `GET /api/scan` | 探活 | 告诉前端 key 配好没 |
| `POST /api/scan` | 识别书名 | 收图片二进制，返回 NDJSON 流 |
| `GET /api/search?title=` | 查豆瓣 | 返回 `{matched, cover, author, year, id}` |
| `GET /api/enrich?title=` | 写简介 | 返回 `{intro, hook, vibe, tags, grade, similar}` |
| `GET /api/detail?id=&title=` | 详情页 | 豆瓣评分/简介/短评 + AI 四段解读 |
| `GET /api/cover?u=` | 封面代理 | 带 Referer 抓豆瓣图，内存缓存 7 天 |

---

## 三、两个必须由服务端做的事

**1. 豆瓣搜索接口没有 CORS 头** —— 浏览器直连会被拦，只能服务端转发。

**2. 豆瓣封面有防盗链** —— 实测：

| 请求 | 结果 |
|---|---|
| 不带 Referer | `418` |
| Referer 是随便一个域名 | `403` |
| Referer 是 `https://book.douban.com/` | `200` |

浏览器发请求时改不了 Referer，所以封面必须由 `/api/cover` 代抓。
`/api/cover` 只放行 `*.doubanio.com`，避免变成公开代理。

---

## 四、封面分两态

| 情况 | 卡片上显示 |
|---|---|
| 豆瓣搜到、且书名对得上 | 真实书封（角标「豆瓣书封」） |
| 没搜到 / 书名对不上 | 程序化封面（角标「自绘封面」） |

**为什么宁可不贴也不贴错**：书名必须等价匹配（完全相同，或一方包含另一方且长度差 ≤ 4）。
《揭秘物理》在豆瓣有两个版本，贴错了比贴不上尴尬得多。所以匹配不上就直接走程序化封面。

程序化封面用书名做 hash 取色相，**同一本书永远是同一张封面**，而且完全没有网络依赖。

---

## 五、目录结构

```
bookshelf-scanner/
├─ app/
│  ├─ page.tsx              入口
│  ├─ layout.tsx
│  ├─ globals.css           全部样式（无 UI 库、无网络字体）
│  └─ api/
│     ├─ scan/route.ts      流式识别
│     ├─ search/route.ts    豆瓣匹配
│     ├─ enrich/route.ts    简介生成
│     └─ cover/route.ts     封面代理
├─ components/
│  ├─ ShelfScanner.tsx      主流程 + 滑动手势
│  ├─ BookCard.tsx          卡片
│  └─ CoverArt.tsx          程序化封面
├─ lib/
│  ├─ deepseek.ts           DeepSeek 调用（原生 fetch）
│  ├─ douban.ts             豆瓣搜索 + 匹配打分
│  ├─ prompt.ts             提示词 + 书名解析
│  └─ types.ts
└─ .env.local               ★ key 填这里
```

---

## 六、手机上点按钮没反应？

按顺序排查：

**0. 先看这条 —— 开发模式下手机访问的坑（踩过一次，很隐蔽）**

Next 16 的开发服务器默认只允许 `localhost` 加载 `/_next/*` 的 JS。
手机用局域网 IP 访问时，**HTML 能拿到（页面正常显示），但所有 JS 被 403 挡掉**。

结果就是：页面看着好好的，相册也能打开，但选完照片毫无反应 —— 因为 React 根本没加载，`onChange` 也没绑定。

`next.config.mjs` 里已经用 `allowedDevOrigins` 把本机所有局域网 IP 加进去了。
**换了网络之后要重启一次 `npm run dev`**，它会重新收集当前 IP。

自己验证一下（把 IP 换成你的）：

```bash
curl -o /dev/null -w "%{http_code}\n" \
  -H "Origin: http://192.168.1.10:3000" \
  "http://192.168.1.10:3000/_next/static/chunks/随便一个.js"
```

`200` 就对了，`403` 说明 `allowedDevOrigins` 没覆盖到这个 IP。

**1. 别用微信打开。** 微信内置浏览器会拦掉拍照上传，链接发到微信里点开基本是死的。
用 **Safari**（iPhone）或 **Chrome**（Android）打开地址。

**2. 改完代码要重新加载页面。** 手机浏览器缓存很顽固，下拉刷新或者关掉标签页重开。

**3. 加上 `?debug=1` 看真实报错。**

```
http://192.168.3.28:3000/?debug=1
```

页面底部会出现一个红框，里面是 JS 报错。把那个截图发出来就行 ——
这是手机上唯一能看报错的办法，不用连电脑。

**4. 确认手机和电脑在同一个 WiFi 下**，而且电脑上 `npm run dev` 还在跑。

> 实现上有个坑：`<input type="file">` 不能用 `hidden` 或 `display:none` 隐藏，
> iOS Safari 会拒绝打开选择器。这里用的是 `.sr-file`（裁剪到 1px + `clip`）
> 配合 `<label for>` 原生触发，不依赖 JS 的 `.click()`。

---

## 七、常见问题

**「缺少 DEEPSEEK_API_KEY」**
`.env.local` 里没填 key，或者填完没重启 `npm run dev`。

**一本都没认出来**
拍的时候注意：正对书架、光线足、别开闪光灯、只拍一排。书脊反光或侧面斜拍识别率会掉很多。

**封面显示「自绘封面」但书明明有**
豆瓣没收录这本，或者书名跟豆瓣上的对不上（比如带不带「注音版」「第 2 版」）。
这是数据源的上限，不是 bug。

**换模型**
`.env.local` 里改 `DEEPSEEK_VISION_MODEL` / `DEEPSEEK_TEXT_MODEL`。
火山方舟的豆包视觉模型也能用，只要改 `DEEPSEEK_BASE_URL` 和模型名两个值（接口是 OpenAI 兼容的），
同时把 `DEEPSEEK_THINKING` 改成 `off`（方舟不认这个字段）。

**没填 key 也想先跑通流程**
仓库里有个假模型服务，可以验证「识别 → 查封面 → 写简介」整条链路：

```bash
node scripts/mock-deepseek.mjs          # 另开一个终端
DEEPSEEK_API_KEY=test DEEPSEEK_BASE_URL=http://127.0.0.1:4000 npm run dev
```

注意：同一个项目同时只能跑一个 `next dev`，要先停掉原来的。

**为什么要关思考模式**
DeepSeek 的思考模式默认是打开的（effort=high）。开着的话首字要等十几秒，
而且思维链会吃掉 `max_tokens`，把书名单截断。所以 `lib/deepseek.ts` 里固定传
`thinking: {type: "disabled"}`，这是「3~5 秒出第一张卡」的前提。
