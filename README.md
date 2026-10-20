# 扫书 · AI 书架速览器

> 拍一张书架照片，AI 读出书脊上的书名，给每本书写一句话简介和推荐理由，做成可以左右滑的卡片。

社区图书角用的小工具。不用打字搜，也不用把书一本本抽出来翻——拍一张，滑着看，决定借哪本。

<p>
  <img src="docs/screenshots/card.jpg" width="270" alt="闪卡">
  <img src="docs/screenshots/detail.jpg" width="270" alt="详情页">
  <img src="docs/screenshots/shelf.jpg" width="270" alt="书架">
</p>

## 它解决什么

社区图书角、班级图书角、家里的书架，书都是密密麻麻排着的：书脊磨花了看不清、抽出来才知道讲什么、想找一本合适的要翻半天。

这个工具把"站在书架前挑书"变成"刷卡片"：

1. **拍** —— 对着书架拍一张，只拍一排
2. **认** —— 视觉模型读出书脊上的书名，认出一本就先出一张卡
3. **滑** —— 每张卡有封面、一句话简介、钩子和标签，左右滑换书
4. **定** —— 喜欢的记下来，生成一个借书清单；想深看就进详情页

## 功能

| 功能 | 说明 |
|---|---|
| 拍照识别 | 书脊书名识别，上限 30 本，流式返回，认出一本就先出卡 |
| 闪卡速览 | 左右滑动 / 点左右两侧 / 点按钮，三种翻页方式 |
| 一句话简介 | 8 岁能听懂的大白话，配「钩子」和「气质词」 |
| 真封面 | 豆瓣封面由服务端代抓（含防盗链处理），本地缓存 |
| AI 画封面 | 豆瓣没有的书，用 Seedream 现画一张（画面内不出现文字） |
| 详情页 | 豆瓣评分 / 简介 / 短评 + 四段深度解读，本地缓存 |
| 个性化推荐 | 填年级、性格、偏好，AI 判断每本书「适不适合你」并给理由，可只看推荐 |
| 书架 | 每次拍照存成一册，平铺成书架网格，可回看、改名、再刷一遍 |
| 使用者画像 | 年级 / 性别 / 性格 / 偏好，全部存在本机 |
| 自动轮播 | 5.2 秒自动翻页，手动操作即刻停止 |

## 怎么做的

```
手机浏览器
  └─ 拍照 → 本地压到长边 1536 / JPEG 0.72（约 150~250KB）
      └─ POST /api/scan （二进制上传，比 base64 小三分之一）
           └─ DeepSeek 视觉模型：流式吐书名，一行一本
                ├─ 收到第一个书名 → 立刻 /api/search 查豆瓣封面
                ├─ 同时          → /api/enrich 写简介、气质词、推荐判断
                └─ 卡片先出来，文案后填（渐进渲染）
```

### 接口

| 接口 | 作用 |
|---|---|
| `POST /api/scan` | 收图片二进制，返回 NDJSON 流（书名一条条推） |
| `GET /api/search?title=` | 豆瓣搜索 + 可信度匹配 |
| `GET /api/enrich?title=&grade=&traits=…` | 简介 / 钩子 / 气质词 / 是否推荐 |
| `GET /api/detail?id=&title=` | 豆瓣评分短评 + 四段深度解读 |
| `GET /api/cover?u=` | 豆瓣封面代理（带 Referer，绕过防盗链） |
| `GET /api/cover-gen?title=&intro=&vibe=` | Seedream 生成封面 |

### 几个关键设计

**边认边出卡。** 不等奖全部识别完才渲染，第一个书名到了就开始查封面、写文案，首张卡 3~5 秒可见。

**不敢把「服务器能干的活」交给模型。** 书名对比、封面匹配、豆瓣评分都是代码做的；模型只做两件事：看图读字、说人话。让语言模型去做数据库查询，它只会编。

**豆瓣封面必须服务端代抓。** 实测：不带 Referer 返回 418，Referer 不是豆瓣域名返回 403。浏览器改不了 Referer，所以由后端代抓并缓存。

**生成的图片不能存 URL。** 方舟返回的图片地址约 24 小时过期，必须当场下载，转成 dataURL 存本地。

**封面缓存三层。** 内存（0.004s）→ 磁盘 `.cache/covers`（0.2s）→ 豆瓣（3~8s）；前端还有一层 localStorage（0.000s）。

**模型名会下架。** 配置的模型 404 时自动降级到备选链，不会因为一个名字写错就整个功能挂掉。

## 本地运行

需要 Node 20.9 以上（仓库有 `.nvmrc`）。

```bash
pnpm install          # 或 npm install
cp .env.example .env.local   # 然后填 key
pnpm dev
```

打开 http://localhost:3000

### 要配的环境变量

| 变量 | 必填 | 用途 |
|---|---|---|
| `DEEPSEEK_API_KEY` | ✅ | 识别书名 + 写简介（`deepseek-flash`） |
| `ARK_API_KEY` | 可选 | Seedream 生成封面，不填就用程序化封面 |
| `ARK_IMAGE_MODEL` | 可选 | 默认 `doubao-seedream-4-0-20260415` |

没有 key 也能跑通整条链路：`node scripts/mock-deepseek.mjs` 起一个假模型，用 `DEEPSEEK_BASE_URL=http://127.0.0.1:4000` 指过去。

### 部署

见 [docs/DEPLOY-sealos.md](docs/DEPLOY-sealos.md)（Sealos Devbox 与容器镜像两种方式）。

### 手机上访问

电脑和手机连同一个 WiFi，用 `http://<电脑主机名>.local:3000`（比 IP 稳，路由器换 IP 也不受影响）。

安卓不认 `.local`，用局域网 IP。

> Next 16 开发服务器默认只让 localhost 加载 JS，手机用其它地址访问会 403。`next.config.mjs` 里已经把本机所有 IP 和主机名加进 `allowedDevOrigins`，换网络后重启一次即可。

## 目录

```
app/
  api/scan      流式识别
  api/search    豆瓣匹配
  api/enrich    简介与推荐
  api/detail    详情页
  api/cover     封面代理
  api/cover-gen Seedream 生图
  skin.css      全部样式（无 UI 库、无网络字体）
components/
  ShelfScanner  主流程 + 手势
  BookCard      闪卡
  BookDetail    详情页
  AlbumShelf    书架
  HistoryList   历史
  ProfileSheet  使用者画像
  CoverArt      程序化封面
lib/
  deepseek      模型调用（原生 fetch）
  arkImage      Seedream
  douban        搜索 + 条目页解析
  prompt        提示词
  albums        相册存储
  profile       画像存储
  coverStore    封面磁盘缓存
```

## 已知限制

- 书脊识别率取决于照片：反光、侧拍、书脊破损都会掉。正对、光线足、只拍一排最好。
- 豆瓣没收录的书拿不到真封面，会用程序化封面或 AI 生成的封面。
- 数据都在 localStorage，换浏览器或清缓存就没了。
- 30 本上限，再多会摊薄单本书在画面里的像素，识别率下降。

## AI 使用说明

界面代码、提示词初稿、README 草稿使用了 AI 编程工具辅助生成；产品形态、交互流程、双模型串联方案、缓存与降级策略由参赛者设计并逐项验证。

详细说明见 [AI-使用声明.md](AI-使用声明.md)。
