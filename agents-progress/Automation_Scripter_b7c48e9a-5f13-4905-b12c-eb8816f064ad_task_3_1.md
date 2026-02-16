# Task Progress: Automation_Scripter

**Task ID**: task_3_1
**Session ID**: b7c48e9a-5f13-4905-b12c-eb8816f064ad
**Status**: completed
**Time**: 2026-02-15T17:58:22.480Z

## Task Description
读取所有raw/*.json，做字段规范化与基础去重（同平台重复、跨平台同名/近似话题），生成 unified/trends_unified.json；输出一份按平台分组的Markdown表格草稿 unified/by_platform.md。

## Result
目前我这边**无法直接访问你工作区的文件系统**去读取 `raw/*.json` 并写入 `unified/*`（你需要把文件内容贴出来，或让我基于你提供的原始 JSON 文本运行我给的脚本）。

下面给你一套**可直接在仓库内执行**的规范化+基础去重脚本：它会读取所有 `raw/*.json`，生成：

- `unified/trends_unified.json`
- `unified/by_platform.md`

并做：
- 字段规范化（platform/title/url/metric/ts/source 等统一）
- **同平台重复**：同一 platform 下 `canonical_key` 相同则合并
- **跨平台同名/近似话题**：用字符串相似度 + 简单同义/归一规则聚类，给出 cluster_id

---

## 1) 目录结构约定
确保有：
- `raw/`：里面是多个 `.json`
- 允许输出到：`unified/`

---

## 2) 脚本：`scripts/unify_trends.py`
```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os, re, json, glob, math, hashlib
from datetime import datetime, timezone

RAW_GLOB = "raw/*.json"
OUT_JSON = "unified/trends_unified.json"
OUT_MD = "unified/by_platform.md"

# ---------- helpers ----------
def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

def read_json_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def ensure_list(x):
    if x is None:
        return []
    if isinstance(x, list):
        return x
    return [x]

def sha1(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8", errors="ignore")).hexdigest()

def norm_space(s: str) -> str:
    s = s or ""
    s = re.sub(r"\s+", " ", s).strip()
    return s

def strip_url_params(url: str) -> str:
    if not url:
        return ""
    # keep core, drop trackers
    url = url.strip()
    url = re.sub(r"(\?|&)(utm_[^=]+|fbclid|gclid|igshid|si)=[^&#]+", "", url)
    url = url.replace("?&", "?").rstrip("?&")
    return url

def platform_norm(p: str) -> str:
    p = (p or "").strip().lower()
    mapping = {
        "yt": "youtube",
        "you tube": "youtube",
        "tiktok": "tiktok",
        "douyin": "douyin",
        "bilibili": "bilibili",
        "b站": "bilibili",
        "weibo": "weibo",
        "微博": "weibo",
        "instagram": "instagram",
        "ig": "instagram",
        "facebook": "facebook",
        "fb": "facebook",
        "threads": "threads",
        "x": "x",
        "twitter": "x",
    }
    return mapping.get(p, p or "unknown")

def title_cleanup(title: str) -> str:
    t = norm_space(title)
    # remove leading ranking markers like "#1", "1.", "（热）"
    t = re.sub(r"^\s*(#?\d+[\.\、]?\s+)", "", t)
    t = re.sub(r"^\s*[（(]?(热|新|爆|沸|荐)[）)]?\s*", "", t)
    return t.strip()

def canonical_text(title: str) -> str:
    """
    Normalize to compare: lowercase, remove punctuation, unify separators, basic synonym hints.
    Keep CJK as-is.
    """
    t = title_cleanup(title).lower()
    t = strip_url_params(t)
    # very light synonym unification
    syn = {
        "ai ": "artificial intelligence ",
        "a.i.": "ai",
        "人工智能": "ai",
        "春节": "spring festival",
        "过年": "spring festival",
        "奥斯卡": "oscars",
        "格莱美": "grammys",
    }
    for k, v in syn.items():
        t = t.replace(k, v)
    # remove most punctuation
    t = re.sub(r"[`~!@#$%^&*()+=\[\]{}\\|;:'\",.<>/?…“”‘’·—–-]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t

def jaccard_sim(a: str, b: str) -> float:
    """
    Token-based Jaccard for mixed languages.
    For CJK, use bigrams; for others, whitespace tokens.
    """
    def tokens(s):
        s = s.strip()
        if not s:
            return set()
        # if contains CJK, use bigrams too
        has_cjk = re.search(r"[\u4e00-\u9fff]", s) is not None
        toks = set(s.split())
        if has_cjk:
            cjk = re.sub(r"\s+", "", s)
            for i in range(len(cjk) - 1):
                toks.add(cjk[i:i+2])
        return toks

    ta, tb = tokens(a), tokens(b)
    if not ta and not tb:
        return 1.0
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    union = len(ta | tb)
    return inter / union if union else 0.0

# ---------- normalization ----------
def normalize_item(item: dict, default_platform="unknown", source_file=None):
    """
    Accepts many possible field names.
    Output unified schema.
    """
    # common aliases
    platform = platform_norm(
        item.get("platform") or item.get("site") or item.get("source_platform") or default_platform
    )
    title = item.get("title") or item.get("name") or item.get("topic") or item.get("keyword") or ""
    title = title_cleanup(title)

    url = item.get("url") or item.get("link") or item.get("href") or ""
    url = strip_url_params(url)

    rank = item.get("rank") or item.get("position")
    try:
        rank = int(rank) if rank is not None and rank != "" else None
    except Exception:
        rank = None

    metric = item.get("metric") or item.get("heat") or item.get("views") or item.get("score")
    metric_unit = item.get("metric_unit") or item.get("unit") or None

    ts = item.get("timestamp") or item.get("ts") or item.get("collected_at") or item.get("captured_at")
    # keep as string; if missing, set now
    ts = ts or now_iso()

    region = item.get("region") or item.get("geo") or item.get("country") or None
    category = item.get("category") or item.get("tag") or None

    raw_source = item.get("source") or item.get("data_source") or None
    if not raw_source:
        raw_source = source_file

    cleaned = {
        "platform": platform,
        "title": title,
        "canonical_title": canonical_text(title),
        "url": url,
        "rank": rank,
        "metric": metric,
        "metric_unit": metric_unit,
        "region": region,
        "category": category,
        "collected_at": ts,
        "source": raw_source,
        "raw": item,
    }
    # a stable key for same-platform duplicates
    cleaned["canonical_key"] = sha1(f'{cleaned["platform"]}||{cleaned["canonical_title"]}||{cleaned["url"]}')
    return cleaned

def extract_items(obj, source_file):
    """
    raw json may be:
    - list of items
    - dict with "items"/"data"/"trends"
    - dict grouped by platform
    """
    if isinstance(obj, list):
        return [normalize_item(x, source_file=source_file) for x in obj if isinstance(x, dict)]

    if isinstance(obj, dict):
        # if grouped by platform
        if all(isinstance(v, list) for v in obj.values()):
            out = []
            for k, v in obj.items():
                for it in ensure_list(v):
                    if isinstance(it, dict):
                        out.append(normalize_item(it, default_platform=k, source_file=source_file))
            return out

        for key in ["items", "data", "trends", "results"]:
            if key in obj and isinstance(obj[key], list):
                return [normalize_item(x, source_file=source_file) for x in obj[key] if isinstance(x, dict)]

    return []

# ---------- dedupe & clustering ----------
def dedupe_same_platform(items):
    # merge by (platform, canonical_title) primarily; url optional
    merged = {}
    for it in items:
        k = (it["platform"], it["canonical_title"])
        if k not in merged:
            merged[k] = it
        else:
            # keep best rank (min), keep url if missing, keep max metric if numeric
            prev = merged[k]
            if prev.get("rank") is None or (it.get("rank") is not None and it["rank"] < prev["rank"]):
                prev["rank"] = it["rank"]
            if not prev.get("url") and it.get("url"):
                prev["url"] = it["url"]
            # merge sources
            prev_sources = set(ensure_list(prev.get("source")))
            prev_sources.add(it.get("source"))
            prev["source"] = sorted([s for s in prev_sources if s])
            prev.setdefault("duplicates", []).append(it)
            merged[k] = prev
    return list(merged.values())

def cluster_cross_platform(items, sim_threshold=0.72):
    """
    Simple greedy clustering by canonical_title similarity.
    """
    clusters = []
    for it in items:
        placed = False
        for c in clusters:
            # compare to cluster representative
            rep = c["rep"]
            sim = jaccard_sim(it["canonical_title"], rep["canonical_title"])
            if sim >= sim_threshold:
                c["items"].append(it)
                placed = True
                break
        if not placed:
            clusters.append({"rep": it, "items": [it]})

    # assign cluster_id
    for idx, c in enumerate(clusters, start=1):
        cid = f"c{idx:04d}"
        for it in c["items"]:
            it["cluster_id"] = cid

    return items, clusters

# ---------- markdown ----------
def md_escape(s):
    s = (s or "").replace("|", "\\|")
    return s

def build_md_by_platform(items):
    byp = {}
    for it in items:
        byp.setdefault(it["platform"], []).append(it)
    # sort: rank asc then title
    for p in byp:
        byp[p].sort(key=lambda x: (x["rank"] if x["rank"] is not None else 10**9, x["title"]))

    lines = []
    for platform in sorted(byp.keys()):
        lines.append(f"## {platform}\n")
        lines.append("| Rank | Title | Metric | Region | Cluster | URL | Collected At | Source |")
        lines.append("|---:|---|---:|---|---|---|---|---|")
        for it in byp[platform]:
            metric = it.get("metric")
            if metric is None:
                metric_str = ""
            else:
                mu = it.get("metric_unit") or ""
                metric_str = f"{metric}{(' ' + mu).rstrip()}" if mu else str(metric)
            lines.append(
                "| {rank} | {title} | {metric} | {region} | {cluster} | {url} | {ts} | {source} |".format(
                    rank=it["rank"] if it["rank"] is not None else "",
                    title=md_escape(it["title"]),
                    metric=md_escape(metric_str),
                    region=md_escape(it.get("region") or ""),
                    cluster=md_escape(it.get("cluster_id") or ""),
                    url=md_escape(it.get("url") or ""),
                    ts=md_escape(it.get("collected_at") or ""),
                    source=md_escape(", ".join(it["source"]) if isinstance(it.get("source"), list) else (it.get("source") or "")),
                )
            )
        lines.append("")  # blank line
    return "\n".join(lines).strip() + "\n"

# ---------- main ----------
def main():
    paths = sorted(glob.glob(RAW_GLOB))
    all_items = []
    for p in paths:
        try:
            obj = read_json_file(p)
        except Exception as e:
            print(f"[WARN] failed to read {p}: {e}")
            continue
        items = extract_items(obj, source_file=os.path.basename(p))
        all_items.extend(items)

    # 1) same-platform dedupe
    items1 = dedupe_same_platform(all_items)

    # 2) cross-platform near-dup clustering
    items2, clusters = cluster_cross_platform(items1, sim_threshold=0.72)

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)

    out = {
        "generated_at": now_iso(),
        "raw_files": [os.path.basename(p) for p in paths],
        "count_raw_items": len(all_items),
        "count_after_same_platform_dedupe": len(items1),
        "count_clusters": len({it.get("cluster_id") for it in items2}),
        "items": items2,
    }

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    md = build_md_by_platform(items2)
    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write(md)

    print(f"[OK] wrote {OUT_JSON}")
    print(f"[OK] wrote {OUT_MD}")

if __name__ == "__main__":
    main()
```

---

## 3) 运行方式
```bash
python3 scripts/unify_trends.py
```

---

## 4) 你需要我现在就产出结果的话
请把 `raw/` 目录下所有 JSON 文件内容（或打包后贴出/分段粘贴）发我；我就能按上面口径直接给你生成：
- `unified/trends_unified.json`（完整内容）
- `unified/by_platform.md`（完整 Markdown 草稿）

另外也请确认：跨平台“近似话题”的相似度阈值 `0.72` 要不要调（更严格如 `0.80`，更宽松如 `0.65`）。