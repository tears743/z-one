# Task Progress: Data_Structuring_Analyst

**Task ID**: task_2_1
**Session ID**: 2e35761e-97c2-44b4-8408-437759cfdc6e
**Status**: completed
**Time**: 2026-02-15T18:21:32.055Z

## Task Description
读取data目录下所有jsonl，标准化字段（platform, region, locale, collected_at, topic_raw, hashtags, rank, metric_name, metric_value, url, notes, evidence）。进行去重与相似话题合并（基于关键词/编辑距离/同URL/同事件别名）。输出：1)“outputs/trends_master_table.csv” 2)“outputs/topic_clusters.json”。

## Result
我目前在这个对话环境里**无法直接读取你工作区的 `data/` 目录、也无法写入 `outputs/` 文件**（没有挂载文件系统/读写工具）。  
但我可以把**可直接运行的本地脚本**给你：会读取 `data/*.jsonl`，做字段标准化、去重与相似话题合并，并生成你要的：

1) `outputs/trends_master_table.csv`  
2) `outputs/topic_clusters.json`

下面给出一份“开箱即用”的 Python 脚本（包含：字段映射/时间规范化/去重规则/相似合并/主题聚类/跨平台共振点与共现词统计），你在本地运行即可产出文件。

---

## 运行方式

```bash
pip install pandas python-dateutil rapidfuzz scikit-learn
python build_trends_outputs.py
```

将以下脚本保存为：`build_trends_outputs.py`

---

## 脚本：读取 data/*.jsonl → 标准化/去重/聚类 → 输出 CSV + JSON

```python
import os, json, glob, re, hashlib
from datetime import datetime, timezone
from dateutil import parser as dtparser

import pandas as pd
from rapidfuzz.distance import Levenshtein
from rapidfuzz import fuzz
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import AgglomerativeClustering


DATA_DIR = "data"
OUT_DIR = "outputs"
MASTER_CSV = os.path.join(OUT_DIR, "trends_master_table.csv")
CLUSTERS_JSON = os.path.join(OUT_DIR, "topic_clusters.json")

os.makedirs(OUT_DIR, exist_ok=True)

# -------------------------
# Helpers: normalization
# -------------------------
def norm_space(s: str) -> str:
    s = "" if s is None else str(s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def norm_platform(p: str) -> str:
    p = norm_space(p).lower()
    mapping = {
        "x": "X",
        "twitter": "X",
        "reddit": "Reddit",
        "tiktok": "TikTok",
        "douyin": "Douyin",
        "抖音": "Douyin",
        "weibo": "Weibo",
        "微博": "Weibo",
        "youtube": "YouTube",
        "yt": "YouTube",
        "instagram": "Instagram",
        "ig": "Instagram",
        "facebook": "Facebook",
        "fb": "Facebook",
    }
    return mapping.get(p, p.upper() if p else "")

def norm_region(r: str) -> str:
    r = norm_space(r)
    # allow raw region slug like "worldwide", "united-states"
    # also accept ISO-like "US", "GB", "JP", "CN"
    return r

def norm_locale(loc: str) -> str:
    loc = norm_space(loc)
    if not loc:
        return ""
    # lightly normalize: en-US -> en_US
    loc = loc.replace("-", "_")
    return loc

def parse_time(x):
    if x is None or x == "":
        return ""
    if isinstance(x, (int, float)):
        # assume unix seconds
        try:
            return datetime.fromtimestamp(x, tz=timezone.utc).isoformat()
        except Exception:
            return ""
    s = norm_space(x)
    try:
        dt = dtparser.parse(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return ""

def extract_hashtags(obj):
    # accept keywords_or_hashtags, hashtags, tags; split from topic text too
    tags = []
    for k in ["hashtags", "keywords_or_hashtags", "tags"]:
        v = obj.get(k)
        if isinstance(v, list):
            tags.extend([norm_space(t) for t in v if norm_space(t)])
        elif isinstance(v, str) and v.strip():
            tags.extend([norm_space(t) for t in re.split(r"[,\s]+", v) if t.strip()])

    topic = norm_space(obj.get("topic") or obj.get("title") or obj.get("keyword") or obj.get("trend") or "")
    tags.extend(re.findall(r"#\w+", topic))
    tags = [t for t in tags if t.startswith("#")]
    # dedupe preserving order
    seen = set()
    out = []
    for t in tags:
        tl = t.lower()
        if tl not in seen:
            out.append(t)
            seen.add(tl)
    return out

def canonical_url(u: str) -> str:
    u = norm_space(u)
    if not u:
        return ""
    # strip tracking params
    u = re.sub(r"[?#].*$", "", u)
    # normalize reddit permalinks etc minimal
    return u

def pick_metric(obj):
    """
    Standard outputs:
      metric_name, metric_value
    Accepts common structures: heat dict, views/score/comments/hot_value, etc.
    """
    if "metric_name" in obj and "metric_value" in obj:
        return norm_space(obj.get("metric_name")), obj.get("metric_value")

    heat = obj.get("heat")
    if isinstance(heat, dict) and heat:
        # choose most informative non-null
        priority = ["tweet_volume", "views", "play_count", "hot_value", "score", "comments", "like_count", "shares"]
        for k in priority:
            if k in heat and heat[k] not in (None, "", "null"):
                return k, heat[k]
        # fallback: first key
        k = next(iter(heat.keys()))
        return k, heat.get(k)

    # common flat fields
    for k in ["views", "view_count", "play_count", "hot_value", "score", "num_comments", "comments", "likes", "like_count"]:
        if k in obj and obj[k] not in (None, "", "null"):
            return k, obj[k]
    return "", ""

def get_url(obj):
    for k in ["url", "link", "video_url", "topic_url", "permalink"]:
        v = obj.get(k)
        if v:
            return canonical_url(v)
    # sometimes evidence.source is the page url
    ev = obj.get("evidence")
    if isinstance(ev, dict) and ev.get("source"):
        return canonical_url(ev.get("source"))
    return ""

def get_notes(obj):
    notes = []
    for k in ["notes", "source_note", "access_status", "limitations"]:
        v = obj.get(k)
        if not v:
            continue
        if isinstance(v, (dict, list)):
            notes.append(json.dumps(v, ensure_ascii=False))
        else:
            notes.append(norm_space(v))
    return " | ".join([n for n in notes if n])

def get_evidence(obj):
    ev = obj.get("evidence")
    if isinstance(ev, dict):
        return json.dumps(ev, ensure_ascii=False)
    if ev is None:
        return ""
    return json.dumps(ev, ensure_ascii=False) if isinstance(ev, (list, str)) else str(ev)

def get_topic_raw(obj):
    # unify: topic/title/keyword
    for k in ["topic_raw", "topic", "title", "keyword", "trend", "query"]:
        v = obj.get(k)
        if v and norm_space(v):
            return norm_space(v)
    return ""

def basic_topic_norm(s: str) -> str:
    s0 = norm_space(s).lower()
    s0 = re.sub(r"[\u200b-\u200f]", "", s0)
    s0 = re.sub(r"[^\w#\u4e00-\u9fff]+", " ", s0)  # keep CJK, words, hashtags
    s0 = re.sub(r"\s+", " ", s0).strip()
    return s0

def topic_fingerprint(topic_norm: str, url: str) -> str:
    # strong key: url if available, else normalized topic
    base = url if url else topic_norm
    return hashlib.sha1(base.encode("utf-8")).hexdigest()

# -------------------------
# Topic attribution (coarse)
# -------------------------
TOPIC_LEX = {
    "entertainment": ["movie","film","actor","actress","music","song","album","concert","trailer","kpop","idol",
                      "celebrity","netflix","disney","anime","drama","娱乐","明星","电影","电视剧","演唱会","综艺","音乐"],
    "sports": ["nba","nfl","mlb","nhl","soccer","football","fifa","uefa","champions league","olympic","tennis",
               "formula","f1","ufc","boxing","cricket","golf","体育","比赛","联赛","冠军","进球","世界杯","奥运"],
    "politics": ["election","vote","president","minister","congress","parliament","senate","bill","policy","campaign",
                 "government","白宫","总统","选举","政府","议会","国会","法案","政策","内阁"],
    "disaster": ["earthquake","tsunami","wildfire","hurricane","typhoon","flood","storm","explosion","shooting",
                 "accident","crash","火灾","地震","台风","洪水","暴雨","事故","爆炸","枪击","坠机","灾害"],
    "technology": ["ai","openai","chatgpt","model","gpu","nvidia","apple","android","iphone","tesla","spacex",
                   "launch","chip","semiconductor","cyber","hack","漏洞","科技","人工智能","模型","芯片","发布会","黑客","网络安全"],
    "finance": ["stock","market","btc","bitcoin","crypto","exchange","fed","rate","inflation","earnings",
                "finance","invest","美元","加息","通胀","股市","比特币","加密","财报","金融"],
    "society": ["school","education","health","hospital","crime","court","trial","protest","strike","migration",
                "社会","教育","医疗","法院","审判","抗议","罢工","治安","犯罪"],
}

def assign_topic(topic_text: str, hashtags):
    txt = (topic_text or "") + " " + " ".join(hashtags or [])
    t = basic_topic_norm(txt)
    scores = {}
    for cat, kws in TOPIC_LEX.items():
        s = 0
        for kw in kws:
            if kw in t:
                s += 1
        scores[cat] = s
    best = max(scores.items(), key=lambda x: x[1])
    return best[0] if best[1] > 0 else "unknown"

# -------------------------
# Load all jsonl
# -------------------------
rows = []
files = sorted(glob.glob(os.path.join(DATA_DIR, "*.jsonl")))
if not files:
    raise SystemExit(f"No jsonl found under {DATA_DIR}/")

for fp in files:
    with open(fp, "r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue

            platform = norm_platform(obj.get("platform") or obj.get("source_platform") or "")
            region = norm_region(obj.get("region") or obj.get("country") or obj.get("geo") or "")
            locale = norm_locale(obj.get("locale") or obj.get("language_hint") or obj.get("lang") or "")
            collected_at = parse_time(obj.get("collected_at") or obj.get("collected_at_utc") or obj.get("ts_utc") or obj.get("timestamp"))

            topic_raw = get_topic_raw(obj)
            hashtags = extract_hashtags(obj)

            # rank
            rank = obj.get("rank")
            try:
                rank = int(rank) if rank is not None and str(rank).strip() != "" else ""
            except Exception:
                rank = ""

            metric_name, metric_value = pick_metric(obj)
            url = get_url(obj)
            notes = get_notes(obj)
            evidence = get_evidence(obj)

            topic_norm = basic_topic_norm(topic_raw)
            rows.append({
                "platform": platform,
                "region": region,
                "locale": locale,
                "collected_at": collected_at,
                "topic_raw": topic_raw,
                "topic_norm": topic_norm,
                "hashtags": json.dumps(hashtags, ensure_ascii=False),
                "rank": rank,
                "metric_name": norm_space(metric_name),
                "metric_value": metric_value,
                "url": url,
                "notes": notes,
                "evidence": evidence,
                "_src_file": os.path.basename(fp),
                "_src_line": line_no,
            })

df = pd.DataFrame(rows)

# -------------------------
# Dedup: exact & near
# Rules:
#  1) same URL => same event
#  2) else same (platform, region, collected_at_date, topic_norm) exact
#  3) else near-duplicate by edit distance / fuzz with blocking
# -------------------------
df["collected_date"] = df["collected_at"].astype(str).str[:10]
df["url_key"] = df["url"].fillna("").astype(str)
df["exact_key"] = (
    df["platform"].fillna("") + "|" +
    df["region"].fillna("") + "|" +
    df["collected_date"].fillna("") + "|" +
    df["topic_norm"].fillna("")
)

# First collapse by URL if present
df["group_key"] = df.apply(lambda r: ("URL|" + r["url_key"]) if r["url_key"] else ("EXACT|" + r["exact_key"]), axis=1)

# within group: keep best row (has metric_value, smaller rank)
def row_quality(r):
    mv = r.get("metric_value")
    has_mv = 0 if mv in (None, "", "null") else 1
    rank = r.get("rank")
    rank_score = -rank if isinstance(rank, int) else 0
    url_score = 1 if r.get("url") else 0
    return (has_mv, url_score, rank_score)

df["_quality"] = df.apply(row_quality, axis=1)
df_sorted = df.sort_values(by=["group_key", "_quality"], ascending=[True, False])
df_d1 = df_sorted.drop_duplicates(subset=["group_key"], keep="first").copy()

# Near-duplicate merge by fuzzy match within blocks of same region+date (and optionally platform)
# We will create cluster ids for near-duplicates where url empty/ different but text similar.
def build_near_clusters(sub):
    # sub: dataframe for a block
    topics = sub["topic_norm"].tolist()
    idxs = sub.index.tolist()
    parent = {i:i for i in idxs}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a,b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    # pairwise with cheap blocking by first token
    first_tok = {}
    for i, t in zip(idxs, topics):
        ft = (t.split(" ")[0] if t else "")
        first_tok.setdefault(ft, []).append(i)

    for ft, bucket in first_tok.items():
        if len(bucket) < 2:
            continue
        b_topics = {i: sub.loc[i, "topic_norm"] for i in bucket}
        for i in range(len(bucket)):
            for j in range(i+1, len(bucket)):
                a, b = bucket[i], bucket[j]
                ta, tb = b_topics[a], b_topics[b]
                if not ta or not tb:
                    continue
                # fuzzy threshold
                sim = fuzz.token_set_ratio(ta, tb)
                ed = Levenshtein.distance(ta, tb)
                maxlen = max(len(ta), len(tb))
                ed_ratio = 1 - (ed / maxlen) if maxlen else 0
                if sim >= 90 or ed_ratio >= 0.88:
                    union(a, b)

    # assign component id
    comp = {}
    for i in idxs:
        root = find(i)
        comp.setdefault(root, []).append(i)
    # return mapping index -> comp_root
    mapping = {}
    for root, members in comp.items():
        for m in members:
            mapping[m] = root
    return mapping

df_d1["near_key"] = ""
for (region, cdate), sub in df_d1.groupby(["region", "collected_date"]):
    mapping = build_near_clusters(sub)
    df_d1.loc[sub.index, "near_key"] = [f"NEAR|{mapping[i]}" for i in sub.index]

# Final event key: prefer URL group, else near_key
df_d1["event_key"] = df_d1.apply(
    lambda r: r["group_key"] if r["group_key"].startswith("URL|") else r["near_key"],
    axis=1
)

# collapse event_key choosing best row again
df_d1["_quality2"] = df_d1.apply(row_quality, axis=1)
df_sorted2 = df_d1.sort_values(by=["event_key", "_quality2"], ascending=[True, False])
master = df_sorted2.drop_duplicates(subset=["event_key"], keep="first").copy()

# add assigned topic category
master["topic_category"] = master.apply(lambda r: assign_topic(r["topic_raw"], json.loads(r["hashtags"]) if r["hashtags"] else []), axis=1)

# -------------------------
# Topic clustering (semantic-ish via TF-IDF)
# -------------------------
texts = master["topic_norm"].fillna("").astype(str).tolist()
# handle tiny datasets
if len(texts) >= 3:
    vec = TfidfVectorizer(ngram_range=(1,2), min_df=1, max_df=0.9)
    X = vec.fit_transform(texts)
    # choose cluster count heuristically
    n = len(texts)
    k = max(2, min(12, int(round(n ** 0.5))))
    model = AgglomerativeClustering(n_clusters=k, metric="cosine", linkage="average")
    labels = model.fit_predict(X.toarray())
else:
    labels = list(range(len(texts)))

master["cluster_id"] = [int(x) for x in labels]

# -------------------------
# Cross-platform resonance + co-occurrence keywords
# -------------------------
def tokenize_for_keywords(s):
    s = basic_topic_norm(s)
    toks = [t for t in s.split(" ") if t and not t.startswith("#") and len(t) >= 2]
    return toks[:50]

cluster_objs = []
for cid, sub in master.groupby("cluster_id"):
    platforms = sorted(set([p for p in sub["platform"].tolist() if p]))
    regions = sorted(set([r for r in sub["region"].tolist() if r]))
    cats = sub["topic_category"].value_counts().to_dict()

    # co-occurrence tokens
    tok_counts = {}
    for t in sub["topic_raw"].fillna("").astype(str).tolist():
        for tok in tokenize_for_keywords(t):
            tok_counts[tok] = tok_counts.get(tok, 0) + 1
    top_tokens = sorted(tok_counts.items(), key=lambda x: (-x[1], x[0]))[:20]

    # resonance: appears on >=2 platforms
    resonance = (len(platforms) >= 2)

    # representative: best ranked / has metric
    rep = sub.sort_values(by=["rank"], ascending=True)
    rep_row = rep.iloc[0].to_dict()

    cluster_objs.append({
        "cluster_id": int(cid),
        "topic_category_major": max(cats.items(), key=lambda x: x[1])[0] if cats else "unknown",
        "topic_category_dist": cats,
        "resonance_cross_platform": resonance,
        "platforms": platforms,
        "regions": regions,
        "size": int(len(sub)),
        "top_cooccurrence_tokens": [{"token": k, "count": int(v)} for k,v in top_tokens],
        "representative": {
            "topic_raw": rep_row.get("topic_raw"),
            "platform": rep_row.get("platform"),
            "region": rep_row.get("region"),
            "collected_at": rep_row.get("collected_at"),
            "url": rep_row.get("url"),
            "metric_name": rep_row.get("metric_name"),
            "metric_value": rep_row.get("metric_value"),
        },
        "items": sub[[
            "platform","region","locale","collected_at","topic_raw","hashtags","rank",
            "metric_name","metric_value","url","notes","evidence","event_key"
        ]].to_dict(orient="records")
    })

cluster_objs = sorted(cluster_objs, key=lambda x: (-x["resonance_cross_platform"], -x["size"], x["cluster_id"]))

# -------------------------
# Output files
# -------------------------
# ensure column order as requested + keep some helpful keys at end
out_cols = ["platform","region","locale","collected_at","topic_raw","hashtags","rank",
            "metric_name","metric_value","url","notes","evidence"]
master_out = master.copy()
master_out = master_out[out_cols + ["topic_category","cluster_id","event_key","_src_file","_src_line"]]

master_out.to_csv(MASTER_CSV, index=False, encoding="utf-8-sig")

with open(CLUSTERS_JSON, "w", encoding="utf-8") as f:
    json.dump({
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "input_files": [os.path.basename(x) for x in files],
        "record_count_raw": int(len(df)),
        "record_count_master": int(len(master_out)),
        "clusters": cluster_objs
    }, f, ensure_ascii=False, indent=2)

print(f"Wrote: {MASTER_CSV}")
print(f"Wrote: {CLUSTERS_JSON}")
print(f"Raw records: {len(df)}  Master records: {len(master_out)}  Clusters: {len(cluster_objs)}")
```

---

## 说明（与你的要求逐项对齐）
- **读取**：`data/` 下所有 `*.jsonl`
- **标准化字段**：输出 CSV 列含你指定的  
  `platform, region, locale, collected_at, topic_raw, hashtags, rank, metric_name, metric_value, url, notes, evidence`
- **去重与相似合并**（同 URL / 同平台地区日期+topic_norm / 近似文本）：  
  - URL 优先强去重  
  - 无 URL 时按 `region+date` 分块做模糊匹配（token_set_ratio / 编辑距离比例）
- **主题归因与聚类**：  
  - `topic_category`（娱乐/体育/政治/灾害/科技/金融/社会/unknown）规则词典  
  - `topic_clusters.json` 中给出每个 cluster 的平台覆盖（用于识别跨平台共振）与共现词 top20

---

如果你希望我按你们团队已有的 JSONL schema 做**更严格的字段映射**（例如你们采集器里用了 `board_or_subreddit/list_name/source` 等字段要落到 `notes` 或额外列），把任意 2-3 行真实样例 JSONL 贴出来，我可以把映射表和合并规则再精准化。