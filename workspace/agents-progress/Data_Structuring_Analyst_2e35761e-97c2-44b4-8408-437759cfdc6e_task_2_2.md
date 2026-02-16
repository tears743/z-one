# Task Progress: Data_Structuring_Analyst

**Task ID**: task_2_2
**Session ID**: 2e35761e-97c2-44b4-8408-437759cfdc6e
**Status**: completed
**Time**: 2026-02-15T18:20:45.127Z

## Task Description
基于聚类结果生成：主题归因（娱乐/体育/政治/灾害/科技/财经等）与跨平台共振点（同一事件在不同平台的表达差异、关键词共现）。输出“outputs/resonance_summary.md”。

## Result
当前对话环境里我拿不到你前一步生成的 `outputs/topic_clusters.json`（也无法读取你的工作区文件），因此**没法基于“真实聚类结果”写出对应的 `outputs/resonance_summary.md` 内容**。

把下面任一项发我即可立刻生成该 Markdown（并按你的聚类逐条做“主题归因 + 跨平台共振点 + 表达差异 + 共现关键词”）：
1) 直接贴出 `outputs/topic_clusters.json`（或上传文件）；或  
2) 贴出其中每个 cluster 的最小字段：`cluster_id, cluster_title, items[{platform, region/locale, topic_raw, hashtags, url, metric_name/value, collected_at}]`。

同时给你一份**可直接在本地生成 `outputs/resonance_summary.md` 的脚本模板**（读取 `topic_clusters.json`，自动主题归因与共振摘要）。你运行后即可得到你要的文件：

```python
# save as: make_resonance_summary.py
import json, os, re
from collections import Counter, defaultdict

IN_PATH = "outputs/topic_clusters.json"
OUT_PATH = "outputs/resonance_summary.md"
os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

TOPIC_TAXONOMY = [
    ("灾害",  [r"earthquake|quake|aftershock|wildfire|fire|flood|typhoon|hurricane|tsunami|爆炸|坍塌|洪水|地震|山火|台风|海啸|失火"]),
    ("政治",  [r"election|vote|senate|congress|parliament|president|pm\b|policy|sanction|war|ceasefire|nato|ukraine|gaza|israel|biden|trump|选举|总统|议会|制裁|停火|战争|外交"]),
    ("财经",  [r"stocks?|nasdaq|dow|sp500|bitcoin|btc|eth|crypto|fed|rate cut|inflation|earnings|ipo|oil|gold|财报|股价|比特币|加息|降息|通胀|汇率|原油|黄金"]),
    ("科技",  [r"ai\b|llm|openai|chatgpt|gpu|nvidia|apple|google|microsoft|tesla|spacex|launch|cybersecurity|漏洞|人工智能|大模型|芯片|发布会|安全"]),
    ("体育",  [r"nba|nfl|mlb|nhl|uefa|ucl|premier league|laliga|f1\b|grand prix|olympics|world cup|进球|冠军|半决赛|决赛|球员|转会"]),
    ("娱乐",  [r"movie|film|box office|album|song|tour|award|grammy|oscar|idol|celebrity|恋情|离婚|综艺|演唱会|票房|新歌|新专辑|明星|剧集"]),
]

PLATFORM_STYLE_HINTS = {
    "X": "短句+话题标签驱动，强调实时性/立场表达",
    "Reddit": "长标题+讨论串，强调证据/背景/辩论",
    "YouTube": "以视频标题/人物/情绪化封面词驱动，强调观看量",
    "TikTok": "以挑战/梗/音乐/标签扩散，强调参与与二创",
    "Weibo": "话题词条+事件进展，强调热度与围观",
    "Douyin": "短视频叙事+本地化热点，强调场景与传播链路",
    "Instagram": "视觉叙事+明星/品牌，强调图片/故事",
    "Facebook": "社群/媒体页扩散，强调分享与本地社区",
}

def normalize_tokens(text):
    if not text: return []
    text = text.lower()
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"[#@]", " ", text)
    text = re.sub(r"[^0-9a-z\u4e00-\u9fff\s]+", " ", text)
    toks = [t for t in text.split() if len(t) >= 2]
    return toks

def classify_theme(cluster_text):
    for theme, pats in TOPIC_TAXONOMY:
        for p in pats:
            if re.search(p, cluster_text, re.I):
                return theme
    return "其他"

with open(IN_PATH, "r", encoding="utf-8") as f:
    clusters = json.load(f)

lines = []
lines.append("# 跨平台趋势共振摘要\n")
lines.append(f"- 数据源：`{IN_PATH}`\n")
lines.append("- 说明：主题归因为基于关键词规则的自动分类；共现关键词来自 cluster 内的 title/topic_raw/hashtags 统计。\n")

# summary counters
theme_count = Counter()
platform_presence = Counter()

for c in clusters.get("clusters", clusters if isinstance(clusters, list) else []):
    cid = c.get("cluster_id") or c.get("id")
    title = c.get("cluster_title") or c.get("title") or ""
    items = c.get("items", [])
    text_blob = " ".join([title] + [str(it.get("topic_raw") or it.get("topic") or "") for it in items] +
                         [" ".join(it.get("hashtags") or []) for it in items])
    theme = classify_theme(text_blob)
    theme_count[theme] += 1

    # platforms in this cluster
    plats = [it.get("platform","unknown") for it in items]
    for p in set(plats):
        platform_presence[p] += 1

    # co-occurrence keywords
    toks = []
    for it in items:
        toks += normalize_tokens(it.get("topic_raw") or it.get("topic") or "")
        for h in (it.get("hashtags") or []):
            toks += normalize_tokens(h)
    top_kw = [w for w,_ in Counter(toks).most_common(10)]

    # resonance criterion: >=2 platforms
    unique_plats = sorted(set(plats))
    resonance = "是" if len(unique_plats) >= 2 else "否"

    lines.append("\n---\n")
    lines.append(f"## Cluster {cid}: {title or '(no title)'}\n")
    lines.append(f"- 主题归因：**{theme}**\n")
    lines.append(f"- 跨平台共振：**{resonance}**（平台：{', '.join(unique_plats) if unique_plats else 'n/a'}）\n")
    if top_kw:
        lines.append(f"- 共现关键词（Top10）：`{', '.join(top_kw)}`\n")

    # platform expression differences
    by_plat = defaultdict(list)
    for it in items:
        by_plat[it.get("platform","unknown")].append(it)

    lines.append("\n### 不同平台的表达差异（归纳）\n")
    for p in unique_plats:
        hint = PLATFORM_STYLE_HINTS.get(p, "表达风格因平台机制而异")
        # pick up to 2 examples
        ex = by_plat[p][:2]
        ex_lines = []
        for e in ex:
            t = e.get("topic_raw") or e.get("topic") or ""
            url = e.get("url") or ""
            ex_lines.append(f"  - {t[:120]}{'...' if len(t)>120 else ''}" + (f"（{url}）" if url else ""))
        lines.append(f"- **{p}**：{hint}\n" + ("\n".join(ex_lines) + "\n" if ex_lines else ""))

    # evidence links
    lines.append("\n### 证据链接（去重）\n")
    urls = []
    for it in items:
        u = it.get("url")
        if u: urls.append(u)
        ev = it.get("evidence")
        if isinstance(ev, dict):
            su = ev.get("source")
            if su: urls.append(su)
    uniq_urls = []
    seen = set()
    for u in urls:
        if u in seen: continue
        seen.add(u); uniq_urls.append(u)
    if uniq_urls:
        for u in uniq_urls[:10]:
            lines.append(f"- {u}\n")
    else:
        lines.append("- （无）\n")

# top overview
lines.insert(3, "## 总览\n" + "\n".join([f"- {k}：{v} 个 clusters" for k,v in theme_count.most_common()]) + "\n")
lines.insert(4, "\n## 平台参与度（出现于多少个 clusters）\n" +
             "\n".join([f"- {k}：{v}" for k,v in platform_presence.most_common()]) + "\n")

with open(OUT_PATH, "w", encoding="utf-8") as f:
    f.write("".join(lines))

print("Wrote:", OUT_PATH)
```

你把 `topic_clusters.json` 给我（或运行脚本产出后把 `resonance_summary.md` 贴回），我可以再进一步把“同一事件在不同平台的表达差异”写得更像分析报告：例如提炼每个平台的叙事框架（情绪/立场/信息密度/是否带行动号召）、以及更精确的“别名/同义表达”映射表。