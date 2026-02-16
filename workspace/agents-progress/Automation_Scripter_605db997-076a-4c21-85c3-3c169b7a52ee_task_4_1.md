# Task Progress: Automation_Scripter

**Task ID**: task_4_1
**Session ID**: 605db997-076a-4c21-85c3-3c169b7a52ee
**Status**: completed
**Time**: 2026-02-16T10:46:16.555Z

## Task Description
如来源内容为长文本/混排列表，编写Node脚本做条目抽取与规范化（节目名/类型/表演者/顺序/时间点字段），输出中间JSON供Content_Structurer合并。仅在人工整理效率低或版本多时触发。

## Result
可触发。你把“长文本/混排列表”的节目单原文（或抓下来的 HTML）丢进一个 `.txt/.html` 文件后，我这边提供一份可复用的 Node 抽取/规范化脚本：从杂乱文本中尽量提取并标准化为：

- `order`（顺序）
- `time`（时间点，若能识别）
- `title`（节目名）
- `type`（类型/形式：歌舞/小品/相声/戏曲/魔术/杂技/串烧/开场等）
- `performers`（表演者数组）
- `raw`（原始行，便于回溯）
- `confidence / issues`（可选：置信度与问题标注）

并输出中间 JSON 供 Content_Structurer 合并。

下面脚本默认输入为纯文本（你可用 `cheerio` 把 HTML 先转成行文本再喂给它；脚本里也提供了非常轻量的 HTML 去标签处理）。

---

## 1) Node 脚本：`extract_programs.js`

```js
#!/usr/bin/env node
/**
 * Usage:
 *   node extract_programs.js input.txt > programs.json
 *   node extract_programs.js input.html --html > programs.json
 */

const fs = require("fs");

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("Usage: node extract_programs.js <input.(txt|html)> [--html]");
  process.exit(1);
}
const inputPath = args[0];
const asHtml = args.includes("--html");

let content = fs.readFileSync(inputPath, "utf8");

// very light HTML to text
if (asHtml) {
  content = content
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function normLine(s) {
  return s
    .replace(/[ \t\u00A0]+/g, " ")
    .replace(/[·•▪►◆■●]/g, " ")
    .replace(/[（(]\s*/g, "（")
    .replace(/\s*[)）]/g, "）")
    .replace(/\s*[:：]\s*/g, "：")
    .replace(/\s*[-—–]\s*/g, "—")
    .trim();
}

function splitLines(text) {
  return text
    .split(/\r?\n/)
    .map(normLine)
    .filter((l) => l && l.length >= 2)
    // drop obvious navigation garbage
    .filter((l) => !/^(分享|责任编辑|来源|Copyright|返回|上一页|下一页)/i.test(l));
}

function parseTime(line) {
  // matches: 20:08 / 20:08:15 / 8:08 / 08:08
  const m = line.match(/\b([01]?\d|2[0-3])[:：]([0-5]\d)(?:[:：]([0-5]\d))?\b/);
  if (!m) return null;
  const hh = String(m[1]).padStart(2, "0");
  const mm = m[2];
  const ss = m[3] ? m[3] : null;
  return { time: ss ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`, _match: m[0] };
}

function guessType(title, line) {
  const s = (title + " " + line).toLowerCase();

  const map = [
    [/开场|序曲|开场秀|开场节目/, "开场"],
    [/小品/, "小品"],
    [/相声/, "相声"],
    [/魔术/, "魔术"],
    [/杂技/, "杂技"],
    [/戏曲|京剧|越剧|昆曲|豫剧|黄梅戏|评剧/, "戏曲"],
    [/朗诵|诗朗诵|诵读/, "朗诵"],
    [/歌曲串烧|串烧|联唱|组曲/, "串烧/联唱"],
    [/舞蹈|群舞/, "舞蹈"],
    [/合唱/, "合唱"],
    [/歌曲|演唱|歌舞|唱/, "歌舞/演唱"],
  ];

  for (const [re, t] of map) if (re.test(s)) return t;
  return null;
}

function splitPerformers(s) {
  // split by common separators
  return s
    .replace(/^[:：\s]+/, "")
    .replace(/^(表演|演唱|演员|表演者)[:：]/, "")
    .split(/[、，,\/&＋+]|(?:\s+与\s+)|(?:\s+and\s+)/i)
    .map((x) => x.trim())
    .filter(Boolean)
    // remove role labels
    .map((x) => x.replace(/^(主持|领舞|伴舞|指挥|演奏)[:：]/, "").trim())
    .filter(Boolean);
}

function extractFromLine(line) {
  // Try patterns:
  // 1) "1. 20:08 《节目名》：张三、李四"
  // 2) "01  《节目名》 张三 李四"
  // 3) "《节目名》——张三、李四"
  // 4) "节目名（类型） 张三/李四"
  // 5) "节目名：表演者"
  const raw = line;

  // order
  let order = null;
  let orderMatch = line.match(/^\s*(\d{1,3})\s*[\.、)\]]\s*/);
  if (!orderMatch) orderMatch = line.match(/^\s*(\d{1,3})\s+(?=\S)/);
  if (orderMatch) {
    order = parseInt(orderMatch[1], 10);
    line = line.slice(orderMatch[0].length).trim();
  }

  // time
  const t = parseTime(line);
  let time = null;
  if (t) {
    time = t.time;
    // remove time token once
    line = line.replace(t._match, "").trim();
  }

  // title extraction: prefer 《》, then “”
  let title = null;
  let m = line.match(/《([^》]{2,80})》/);
  if (m) {
    title = m[1].trim();
    // remove that part
    line = line.replace(m[0], "").trim();
  } else {
    m = line.match(/[“"]([^”"]{2,80})[”"]/);
    if (m) {
      title = m[1].trim();
      line = line.replace(m[0], "").trim();
    }
  }

  // If still no title, try split by separators and take first chunk as title
  // Example: "歌舞 开场喜庆中国：张三 李四"
  if (!title) {
    const parts = line.split(/[：—\-–]|(?=\s{2,})/).map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 1) title = parts[0];
    if (parts.length >= 2) line = parts.slice(1).join("：");
    else line = ""; // leftover unknown
  }

  // performers: look for "：xxx" or "——xxx" after title
  let performers = [];
  let perfStr = null;
  const perfMatch = raw.match(/[:：—\-–]\s*([^《》“”]{2,200})$/);
  if (perfMatch) perfStr = perfMatch[1].trim();

  // also handle "（张三、李四）" at end
  if (!perfStr) {
    const pm = raw.match(/（([^（）]{2,200})）\s*$/);
    if (pm) perfStr = pm[1].trim();
  }

  if (perfStr) performers = splitPerformers(perfStr);

  // type guess
  const type = guessType(title, raw);

  // issues/confidence
  const issues = [];
  if (!title || title.length < 2) issues.push("no_title");
  if (!performers.length) issues.push("no_performers");
  let confidence = 1.0;
  if (issues.includes("no_performers")) confidence -= 0.25;
  if (issues.includes("no_title")) confidence -= 0.5;
  if (!time) confidence -= 0.05;
  if (!type) confidence -= 0.05;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    order,
    time,
    title: title || null,
    type,
    performers,
    raw,
    confidence,
    issues,
  };
}

function isLikelyProgramLine(line) {
  // keep lines that contain 《》 or have order/time or contain typical keywords
  return (
    /《[^》]+》/.test(line) ||
    /^\s*\d{1,3}\s*[\.、)\]]/.test(line) ||
    /\b([01]?\d|2[0-3])[:：]([0-5]\d)\b/.test(line) ||
    /(小品|相声|歌舞|演唱|舞蹈|戏曲|魔术|杂技|朗诵|串烧|联唱)/.test(line)
  );
}

const lines = splitLines(content);

// Extract candidates
let items = lines
  .filter(isLikelyProgramLine)
  .map(extractFromLine);

// Post-process: fill missing order by sequence if majority have order
const orderedCount = items.filter((x) => typeof x.order === "number").length;
if (orderedCount === 0) {
  items = items.map((x, idx) => ({ ...x, order: idx + 1 }));
}

// Deduplicate by (title + performers + time) similarity
function keyOf(x) {
  return [
    (x.title || "").replace(/\s+/g, ""),
    (x.performers || []).join("、").replace(/\s+/g, ""),
    x.time || "",
  ].join("|");
}
const seen = new Set();
const deduped = [];
for (const it of items) {
  const k = keyOf(it);
  if (seen.has(k)) continue;
  seen.add(k);
  deduped.push(it);
}

// Sort by order if possible
deduped.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));

const out = {
  meta: {
    input: inputPath,
    asHtml,
    extractedAt: new Date().toISOString(),
    totalLines: lines.length,
    extractedItems: deduped.length,
  },
  items: deduped,
};

process.stdout.write(JSON.stringify(out, null, 2));
```

---

## 2) 你给我素材时的最低输入格式

任选其一即可触发我跑脚本清洗：
- 直接粘贴长文本（我会让你保存成 `input.txt` 再跑）
- 或给抓取到的 HTML（保存成 `input.html`，加 `--html`）

并告诉我：这份节目单对应的“年份/版本”（如：预告版/网传版/回放章节版），我会在 JSON 的 `meta` 里补上 `versionTag`（如你需要我也可改脚本支持该参数）。