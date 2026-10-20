/**
 * 本地假模型服务，只用来验证管线，不参与正式运行。
 *
 * 用法（另开一个终端）：
 *   node scripts/mock-deepseek.mjs
 *   DEEPSEEK_API_KEY=test DEEPSEEK_BASE_URL=http://127.0.0.1:4000 \
 *     node node_modules/next/dist/bin/next dev -p 3001
 *
 * 它会模仿 DeepSeek 的行为：
 *   - 带图片的请求 → 流式吐 JSON Lines 书名
 *   - 纯文本请求   → 返回一个 JSON 对象
 * 这样没填真 key 也能把「识别 → 查封面 → 写简介」整条链路跑通。
 */
import http from "node:http";

const TITLES = ["揭秘物理", "窗边的小豆豆", "飞向太空立体书", "神奇校车", "完全不存在的一本假书XYZ"];

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url?.includes("/chat/completions")) {
    res.writeHead(404).end("not found");
    return;
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

  const content = body.messages?.[0]?.content;
  const hasImage = Array.isArray(content);
  const isStream = body.stream === true;

  if (hasImage && isStream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    for (const t of TITLES) {
      const payload = JSON.stringify({ choices: [{ delta: { content: `{"t":"${t}"}\n` } }] });
      res.write(`data: ${payload}\n\n`);
      await new Promise((r) => setTimeout(r, 120));
    }
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  const title = JSON.parse(JSON.stringify(body)).messages?.[1]?.content?.match(/《(.+?)》/)?.[1] ?? "这本书";
  const result = {
    intro: `（假数据）《${title}》讲的是一个小朋友发现身边怪事的故事，翻起来很快。`,
    hook: "（假数据）最后一页有个小机关，别跳过去。",
    tags: ["假标签", "科普"],
    grade: "三年级",
  };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: JSON.stringify(result) } }],
    }),
  );
});

server.listen(4000, "127.0.0.1", () => {
  console.log("mock deepseek on http://127.0.0.1:4000");
});
