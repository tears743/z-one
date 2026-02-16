# Task Progress: Narrative_Anomaly_Investigator

**Task ID**: task_3_1
**Session ID**: 2e35761e-97c2-44b4-8408-437759cfdc6e
**Status**: completed
**Time**: 2026-02-15T18:22:46.636Z

## Task Description
读取topic_clusters与master_table，对每个高热聚类做隐藏信号分析：1)传播异常（短时集中、同质化标题/话术、可疑外链）2)叙事框架/立场 3)情绪极化线索 4)地域差异 5)可能的商业/政治信号与利益相关者 6)信息缺口与需要核验点。必要时回到网页抽样查看若干代表性帖子/页面以验证框架。输出“outputs/hidden_signals.md”。

## Result
当前会话里我**无法直接读取**你工作区的 `topic_clusters` 与 `master_table`，也**无法写入**到 `outputs/hidden_signals.md`（缺少文件系统/读写工具与可用浏览器抓取）。要完成你要求的“逐高热聚类隐藏信号分析+抽样回看网页验证”，我需要你提供其一：

- 直接上传/粘贴：`outputs/topic_clusters.json` 与 `outputs/trends_master_table.csv`（或 master_table 的前 200 行 + 全量 cluster 段落）；或  
- 仅粘贴每个**高热 cluster**的最小字段：`cluster_id, size/hot_score(若有), items[{platform, region, locale, collected_at, topic_raw, url, notes/evidence}]`。

在你把数据贴上来之前，我先给你一份**可在本地直接运行**、会读取 `topic_clusters.json + trends_master_table.csv` 并输出 `outputs/hidden_signals.md` 的脚本模板（包含：传播异常/叙事框架与立场/情绪极化/地域差异/商业政治信号与利益相关者/信息缺口与核验清单；并提供“需要人工回看网页”的抽样 URL 清单）。

---

## 本地生成脚本：`make_hidden_signals.py`

> 运行：`python make_hidden_signals.py`  
> 依赖：`pip install pandas rapidfuzz tldextract`

```python
import os, re, json, math
from collections import Counter, defaultdict
from datetime import datetime, timezone

import pandas as pd
import tldextract
from rapidfuzz import fuzz

CLUSTERS_PATH = "outputs/topic_clusters.json"
MASTER_PATH   = "outputs/trends_master_table.csv"
OUT_PATH      = "outputs/hidden_signals.md"

# ---------- parameters ----------
HIGH_HEAT_TOPK = 12          # 输出多少个“高热聚类”（若无热度字段则按size排序）
TIME_BURST_WINDOW_MIN = 30   # 判定短时集中窗口
SAME_COPY_SIM_TH = 92        # 同文案相似度阈值
SUSPICIOUS_TLDS = {"top","xyz","click","live","loan","work","vip","shop","fit","rest","cfd","monster"}
SHORTENERS = {"t.co","bit.ly","tinyurl.com","goo.gl","ow.ly","buff.ly","rb.gy","reurl.cc","is.gd","s.id"}

POLAR_WORDS = {
    "cn": {
        "pos": ["支持","点赞","致敬","感动","正义","澄清","反转","好消息","英雄"],
        "neg": ["震惊","怒","恶心","垃圾","造谣","塌房","抵制","滚","谎言","洗地","带节奏"],
        "call": ["转发","扩散","求证","举报","抵制","别信","维权","冲","站队"],
    },
    "en": {
        "pos": ["support","respect","brave","hero","good news","clarified"],
        "neg": ["shocking","disgusting","trash","fake","hoax","propaganda","boycott","hate","lying"],
        "call": ["share","spread","report","boycott","don’t believe","take action","stand with"],
    }
}

STANCE_HINTS = [
    ("官方/机构背书", [r"官方通报|警方通报|通报称|声明|press release|official statement"]),
    ("阴谋/操控框架", [r"阴谋|操控|被安排|资本做局|deep state|psyop|false flag|cover[- ]?up"]),
    ("受害者/弱者框架", [r"受害者|维权|无助|被欺负|injustice|victim|oppressed"]),
    ("民族/阵营对立", [r"境外势力|恨国|辱华|反华|patriot|traitor|anti[- ]?china|anti[- ]?american"]),
    ("消费主义/带货框架", [r"同款|链接|下单|优惠|折扣|直播间|buy now|use my code|affiliate"]),
]

def safe_load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def domain_of(url):
    if not url: return ""
    ext = tldextract.extract(url)
    dom = ".".join([p for p in [ext.domain, ext.suffix] if p])
    return dom.lower()

def tld_of(url):
    if not url: return ""
    ext = tldextract.extract(url)
    return (ext.suffix or "").lower()

def is_shortener(url):
    d = domain_of(url)
    return d in SHORTENERS

def suspicious_link(url):
    if not url: return False, ""
    d = domain_of(url)
    tld = tld_of(url)
    if is_shortener(url):
        return True, f"短链域名({d})"
    if tld in SUSPICIOUS_TLDS:
        return True, f"可疑TLD(.{tld})"
    # 简单规则：含大量参数/跳转字样
    if re.search(r"redirect|jump|utm_|aff|affiliate|ref=", url, re.I):
        return True, "疑似引流/联盟参数"
    return False, ""

def text_norm(s):
    s = "" if s is None else str(s)
    s = s.lower()
    s = re.sub(r"https?://\S+", " ", s)
    s = re.sub(r"[\u200b-\u200f]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def polarity_signals(text):
    t = text_norm(text)
    out = {"pos":0,"neg":0,"call":0}
    for lang in ["cn","en"]:
        for k in ["pos","neg","call"]:
            for w in POLAR_WORDS[lang][k]:
                if w.lower() in t:
                    out[k] += 1
    return out

def stance_frames(text):
    t = text if text else ""
    frames = []
    for name, pats in STANCE_HINTS:
        for p in pats:
            if re.search(p, t, re.I):
                frames.append(name)
                break
    return frames

def parse_dt(s):
    try:
        return pd.to_datetime(s, utc=True)
    except Exception:
        return pd.NaT

def cluster_heat_score(cluster_obj):
    # 优先：size；若 items 中有 metric_value 尝试做弱聚合
    size = int(cluster_obj.get("size") or len(cluster_obj.get("items", [])) or 0)
    return size

def pick_high_heat(clusters, topk):
    scored = [(cluster_heat_score(c), c) for c in clusters]
    scored.sort(key=lambda x: (-x[0], x[1].get("cluster_id", 1e9)))
    return [c for _, c in scored[:topk]]

def detect_same_copy(items):
    texts = []
    for it in items:
        t = it.get("topic_raw") or ""
        if t: texts.append(t)
    pairs = []
    for i in range(len(texts)):
        for j in range(i+1, len(texts)):
            sim = fuzz.token_set_ratio(text_norm(texts[i]), text_norm(texts[j]))
            if sim >= SAME_COPY_SIM_TH:
                pairs.append((i,j,sim))
    return pairs

def detect_burst(items):
    dts = [parse_dt(it.get("collected_at")) for it in items if it.get("collected_at")]
    dts = [d for d in dts if pd.notna(d)]
    if len(dts) < 3:
        return {"burst": False, "detail": "时间戳不足"}
    dts.sort()
    # sliding window count
    win = pd.Timedelta(minutes=TIME_BURST_WINDOW_MIN)
    best = 0
    best_range = None
    l = 0
    for r in range(len(dts)):
        while dts[r] - dts[l] > win:
            l += 1
        cnt = r - l + 1
        if cnt > best:
            best = cnt
            best_range = (dts[l], dts[r])
    ratio = best / len(dts)
    return {
        "burst": (best >= 5 and ratio >= 0.6),
        "best_cnt": best,
        "total": len(dts),
        "ratio": ratio,
        "range": best_range
    }

def region_split(items):
    by = defaultdict(list)
    for it in items:
        reg = it.get("region") or "unknown"
        by[reg].append(it)
    return {k: len(v) for k,v in sorted(by.items(), key=lambda x: -x[1])}

def platform_split(items):
    by = defaultdict(list)
    for it in items:
        p = it.get("platform") or "unknown"
        by[p].append(it)
    return {k: len(v) for k,v in sorted(by.items(), key=lambda x: -x[1])}

def stakeholder_hints(texts):
    blob = " ".join(texts)
    hints = []
    if re.search(r"company|inc\.|ltd|集团|公司|品牌|发布会|新品|财报|上市|ipo|融资", blob, re.I):
        hints.append("疑似商业主体/品牌营销相关")
    if re.search(r"election|vote|sanction|ministry|parliament|congress|government|总统|选举|制裁|外交部|国务院|警方通报", blob, re.I):
        hints.append("疑似政治/公共治理相关")
    if re.search(r"donate|募捐|捐款|筹款|gofundme|水滴筹|众筹", blob, re.I):
        hints.append("疑似募捐/筹款链路（需核验资金去向）")
    return hints

def main():
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

    clusters_json = safe_load_json(CLUSTERS_PATH)
    clusters = clusters_json.get("clusters", clusters_json if isinstance(clusters_json, list) else [])
    master = pd.read_csv(MASTER_PATH, encoding="utf-8-sig")

    high = pick_high_heat(clusters, HIGH_HEAT_TOPK)

    lines = []
    lines.append("# 高热聚类隐藏信号分析（Hidden Signals）\n\n")
    lines.append(f"- 生成时间(UTC)：{datetime.now(timezone.utc).isoformat()}\n")
    lines.append(f"- 输入：`{CLUSTERS_PATH}` + `{MASTER_PATH}`\n")
    lines.append("- 说明：以下为“异常传播/叙事与立场/情绪极化/地域差异/商业政治信号/信息缺口”线索级研判，需结合原帖/页面进一步核验。\n\n")

    for c in high:
        cid = c.get("cluster_id")
        items = c.get("items", [])
        rep = c.get("representative", {})
        title = (c.get("cluster_title") or rep.get("topic_raw") or "").strip()

        texts = [(it.get("topic_raw") or "") for it in items]
        frames = Counter()
        polar = Counter()
        call_cnt = 0

        for t in texts:
            for fr in stance_frames(t):
                frames[fr] += 1
            ps = polarity_signals(t)
            polar["pos"] += ps["pos"]
            polar["neg"] += ps["neg"]
            polar["call"] += ps["call"]
            call_cnt += (1 if ps["call"] > 0 else 0)

        burst = detect_burst(items)
        same_copy_pairs = detect_same_copy(items)

        # link signals
        urls = [it.get("url") for it in items if it.get("url")]
        doms = [domain_of(u) for u in urls if u]
        dom_top = Counter(doms).most_common(5)
        susp = []
        for u in urls:
            ok, why = suspicious_link(u)
            if ok:
                susp.append((u, why))
        susp = list(dict.fromkeys(susp))[:8]

        reg_dist = region_split(items)
        plat_dist = platform_split(items)

        # choose sample urls for manual verification
        sample_urls = []
        for it in items:
            u = it.get("url")
            if u and u not in sample_urls:
                sample_urls.append(u)
            if len(sample_urls) >= 6:
                break

        hints = stakeholder_hints(texts)

        lines.append(f"---\n\n## Cluster {cid}: {title or '(未命名)'}\n\n")
        lines.append(f"- 规模(size)：{len(items)}；平台分布：{', '.join([f'{k}:{v}' for k,v in list(plat_dist.items())[:6]])}\n")
        lines.append(f"- 地域分布：{', '.join([f'{k}:{v}' for k,v in list(reg_dist.items())[:6]])}\n\n")

        # 1) propagation anomalies
        lines.append("### 1) 传播异常\n")
        if burst.get("burst"):
            r0, r1 = burst.get("range")
            lines.append(f"- 短时集中：疑似在 {TIME_BURST_WINDOW_MIN} 分钟窗口内集中发布/收敛（{burst['best_cnt']}/{burst['total']}，占比 {burst['ratio']:.0%}；区间 {r0} ~ {r1}）\n")
        else:
            lines.append(f"- 短时集中：未见明显（或时间戳不足/分散；{burst})\n")
        if same_copy_pairs:
            lines.append(f"- 同质化文案：存在高相似标题/话术（>= {SAME_COPY_SIM_TH}）的配对 {len(same_copy_pairs)} 组，疑似模板化扩散/多账号同频\n")
        else:
            lines.append("- 同质化文案：未见明显高相似（基于标题/话题文本）\n")
        if dom_top:
            lines.append("- 外链/来源集中度（Top域名）： " + ", ".join([f"{d}({n})" for d,n in dom_top if d]) + "\n")
        if susp:
            lines.append("- 可疑外链线索（短链/可疑TLD/疑似导流参数）：\n")
            for u, why in susp:
                lines.append(f"  - {why}：{u}\n")
        else:
            lines.append("- 可疑外链：未显著发现（仅基于URL规则）\n")
        lines.append("\n")

        # 2) narrative frames
        lines.append("### 2) 叙事框架 / 立场\n")
        if frames:
            lines.append("- 主要框架线索（按出现次数）： " + "；".join([f"{k}:{v}" for k,v in frames.most_common(5)]) + "\n")
        else:
            lines.append("- 主要框架线索：未从标题/话题文本中抽取到明显框架关键词（需回看正文）\n")
        lines.append("\n")

        # 3) affect polarization
        lines.append("### 3) 情绪极化线索\n")
        lines.append(f"- 情绪词粗计数：正向={polar['pos']}，负向={polar['neg']}；行动号召相关={polar['call']}（涉及行动号召的条目约 {call_cnt}/{len(items)}）\n")
        if polar["neg"] > polar["pos"] * 1.5 and polar["neg"] >= 5:
            lines.append("- 极化迹象：负向显著占优，可能伴随指责/抵制/阴谋化叙事扩散\n")
        if polar["call"] >= 5:
            lines.append("- 动员迹象：出现较多“转发/扩散/举报/抵制/站队”等词，需关注是否存在协同动员\n")
        lines.append("\n")

        # 4) regional differences
        lines.append("### 4) 地域差异\n")
        lines.append("- 地域覆盖差异（计数）： " + ", ".join([f"{k}:{v}" for k,v in list(reg_dist.items())[:10]]) + "\n")
        lines.append("- 待验证点：不同地区是否对应不同叙事侧重（如责任归因、受害者/加害者指向、政策诉求）与不同信源（媒体/自媒体/机构）。\n\n")

        # 5) commercial/political signals
        lines.append("### 5) 可能的商业/政治信号与利益相关者\n")
        if hints:
            for h in hints:
                lines.append(f"- {h}\n")
        else:
            lines.append("- 暂无强指示（仅基于标题/话题文本的规则检测）\n")
        lines.append("- 潜在利益相关者清单（需从正文/页面确认）：当事人/机构、平台账号矩阵、相关品牌与渠道号、媒体/地方号、可能受影响行业。\n\n")

        # 6) info gaps & verification
        lines.append("### 6) 信息缺口与需要核验点（证据清单）\n")
        lines.append("- 时间线：首发时间、关键节点（通报/反转/澄清）与各平台扩散先后顺序（需逐条帖时间戳/转发链）\n")
        lines.append("- 信源：是否引用同一“首发媒体/账号/群组”，是否存在洗稿矩阵（需比对正文、图片/视频水印、引用段落）\n")
        lines.append("- 外链：短链跳转落地页、是否带联盟参数/广告投放、落地页备案/主体信息（whois/ICP备案/Meta Pixel等）\n")
        lines.append("- 协同迹象：多账号同频发布、相同配图/字幕模板、相近昵称/注册时间、评论区同质话术（需采样账号画像与评论）\n")
        lines.append("- 事实核验：关键数字/伤亡/金额/政策条款/地点人物是否可被权威记录或多源交叉验证\n")
        if sample_urls:
            lines.append("- 建议人工回看抽样链接（用于验证叙事框架/同文案/导流）：\n")
            for u in sample_urls:
                lines.append(f"  - {u}\n")
        lines.append("\n")

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("".join(lines))

    print("Wrote:", OUT_PATH)

if __name__ == "__main__":
    main()
```

---

## 你需要我“回到网页抽样查看”的部分
在你这边运行脚本后，它会在每个高热 cluster 给出“建议人工回看抽样链接”。你把其中每个 cluster 的 3-6 个 URL（或页面截图/正文摘录）贴回，我可以继续做**二次验证版**：把“叙事框架/立场对立/疑似协同传播证据”从线索提升到更可证的判断（比如：同一稿源、同一跳转链路、同一素材包、同一评论脚本）。

---

把 `topic_clusters.json` 与 `trends_master_table.csv`（或其内容）发我后，我可以直接按你指定的 6 个维度逐个高热聚类输出完整报告文本；若你启用了可写文件工具，我也能按路径为你落盘到 `outputs/hidden_signals.md`。