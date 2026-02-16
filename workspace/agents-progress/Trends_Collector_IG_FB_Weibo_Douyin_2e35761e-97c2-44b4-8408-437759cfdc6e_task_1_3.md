# Task Progress: Trends_Collector_IG_FB_Weibo_Douyin

**Task ID**: task_1_3
**Session ID**: 2e35761e-97c2-44b4-8408-437759cfdc6e
**Status**: completed
**Time**: 2026-02-15T18:20:03.682Z

## Task Description
采集Instagram/Facebook（若公开趋势不可得则记录原因）以及微博/抖音热榜：保留排名与热度值（如有）、话题、链接、时间戳与必要截图。输出到“data/ig_fb_weibo_douyin_trends.jsonl”。

## Result
无法按你的要求完成“抓取Instagram/Facebook + 微博/抖音热榜并输出到 `data/ig_fb_weibo_douyin_trends.jsonl`，附链接/时间戳/必要截图”，因为当前会话未提供可用的联网抓取工具/浏览器，也无法在此环境中访问外部站点与生成/保存截图文件或写入你指定路径的工作区文件。

我可以先把**交付物的JSONL规范与写入模板**准备好，并在你启用以下任一能力后立刻执行真实采集：
1) 提供可联网的抓取工具（Browser/HTTP fetch）与允许访问微博/抖音公开热榜页；  
2) 或你上传各平台热榜页面截图/HTML/导出内容，我来结构化成JSONL并补齐时间戳、限制说明等。

下面是我将用于写入 `data/ig_fb_weibo_douyin_trends.jsonl` 的**记录结构**（每行一条trend）：

```json
{
  "ts_utc": "2026-02-15T00:00:00Z",
  "platform": "weibo|douyin|instagram|facebook",
  "list_name": "热搜榜|抖音热榜|Trends|...",

  "rank": 1,
  "keyword": "话题/关键词",
  "hot_value": "123456" ,
  "hot_value_unit": "热度|指数|views|unknown",
  "category": "娱乐|社会|体育|unknown",

  "url": "https://...",
  "source_note": "若有登录/地域/反爬限制，写明；若用替代公开来源，也写明",
  "access_status": "ok|login_required|geo_blocked|not_available|error",

  "screenshot_paths": ["data/screenshots/xxx.png"],
  "evidence": {
    "page_title": "",
    "captured_text_snippet": ""
  }
}
```

### 我需要你确认/提供的最小信息（否则无法落盘真实数据）
- 采集时间基准：用“现在”还是你指定的时间点？（默认：执行时刻的UTC时间戳）
- 微博热搜来源：你希望用 **s.weibo.com/top/summary**（通常较公开）还是你指定的热搜页链接？
- 抖音热榜来源：抖音PC热榜经常有风控/登录限制；你是否接受使用**公开镜像/第三方趋势页**作为替代来源（我会在 `source_note` 标注）？

只要你回复以上3点，并且为我启用联网/浏览器工具（或直接上传热榜截图/HTML），我就能按要求抓取并把结果写入 `data/ig_fb_weibo_douyin_trends.jsonl`，同时为每个平台记录“能否公开获取”的原因与替代来源。