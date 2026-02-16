要“通过浏览器获取最新价”，我需要你给出**目标标的**与**数据源URL**（或允许我自选公开源）。在你确认“允许使用最新价”后，我会按下面流程执行：打开页面→抓取页面文本→截图存证→提取价格与时间戳→输出`LATEST`锚点字段；若无法获取则回退到`P0`并输出回退声明。

---

## A) 浏览器抓取执行流程（Latest 允许时）

### A.1 输入（你需要提供/确认）
- `{INSTRUMENT}`：标的（示例：现货黄金 XAUUSD / COMEX GC主力 / 沪金 AU）
- `{PREFERRED_SOURCE_URL}`：首选数据源页面URL（强烈建议给1个可公开访问的）
- `{CURRENCY}` `{UNIT}`：币种与单位（如 `USD` + `USD/oz`）
- （可选）备选源URL列表：`{FALLBACK_SOURCE_URLS}`

### A.2 抓取与存证（我将用浏览器工具完成）
1) `browser_navigate({PREFERRED_SOURCE_URL})`
2) `browser_get_content()`：获取页面可见文本/HTML（用于解析）
3) `browser_screenshot(fullPage=false)`：截图存证（必要时fullPage=true）
4) 提取字段（优先级）：
   - 价格：页面中最像“最新价/Last/Price”的数值
   - `quoted_at`：页面若提供“更新时间/Time/As of/Last updated/报价时间”
   - 若页面不提供报价时间：`quoted_at=null`
5) 记录采集时间：`observed_at = 采集当下系统时间（ISO8601, UTC, Z）`

> 关键口径：**observed_at（采集时刻）必填**；quoted_at（报价时点）有则填、无则空。

---

## B) 输出字段（成功获取Latest时）
> 可直接粘贴进报告/JSON的结构（含占位符）

```json
{
  "price_anchor": {
    "mode": "LATEST",
    "latest": {
      "instrument": "{INSTRUMENT}",
      "value": {LATEST_VALUE},
      "currency": "{LATEST_CURRENCY}",
      "unit": "{LATEST_UNIT}",
      "observed_at": "{LATEST_OBSERVED_AT_ISO8601}",
      "quoted_at": "{LATEST_QUOTED_AT_ISO8601_OR_NULL}",
      "source_name": "{LATEST_SOURCE_NAME}",
      "source_url": "{LATEST_SOURCE_URL}",
      "source_method": "web_scrape",
      "source_evidence": {
        "screenshot_taken": true,
        "page_text_captured": true
      }
    }
  }
}
```

### 可插入报告的声明（Latest成功时）
> **价格锚点（最新价）声明：**本报告采用可获取的最新价格作为锚点。最新价为{LATEST_VALUE} {LATEST_CURRENCY}（单位：{LATEST_UNIT}），来源：{LATEST_SOURCE_NAME}（{LATEST_SOURCE_URL}）。本次采集时间（observed_at）为{LATEST_OBSERVED_AT_ISO8601}；若来源提供报价/更新时间，则quoted_at为{LATEST_QUOTED_AT_ISO8601}（未提供则以observed_at为准）。市场价格实时变动，同一来源在不同时间点展示值可能存在差异。

---

## C) 无法获取时的回退策略（强制回退到用户P0）

### 触发条件（任一满足即回退）
- 页面需要登录/验证码/地理限制导致无法访问
- 页面为强前端渲染且文本抓取不到关键数字，截图也无法稳定识别
- 来源未展示明确价格，或价格单位/币种不清晰且无法核验
- 页面提供的是区间/图表而无具体数值

### 回退输出（P0）
```json
{
  "price_anchor": {
    "mode": "P0",
    "P0": {
      "instrument": "{INSTRUMENT}",
      "value": {P0_VALUE},
      "currency": "{P0_CURRENCY}",
      "unit": "{P0_UNIT}",
      "as_of": "{P0_AS_OF_ISO8601}",
      "source_type": "manual",
      "source_ref": "{P0_SOURCE_REF}"
    }
  },
  "price_anchor_fallback": {
    "attempted_latest": true,
    "fallback_reason": "{FALLBACK_REASON}",
    "attempted_source_url": "{PREFERRED_SOURCE_URL}"
  }
}
```

### 可插入报告的声明（回退到P0）
> **价格锚点回退声明：**原计划使用数据源页面的最新价作为锚点，但由于{FALLBACK_REASON}，无法在本次写作/采集时点形成可审计的最新价记录（含价格与时间戳）。因此本报告改用用户提供的P0作为基准锚点：{P0_VALUE} {P0_CURRENCY}（单位：{P0_UNIT}），基准时点{P0_AS_OF_ISO8601}（来源引用：{P0_SOURCE_REF}）。

---

## D) 你现在只需补齐3项，我就能开始“浏览器抓取”
1) 标的：`{INSTRUMENT}`（例如：现货黄金 XAUUSD）
2) 首选数据源URL：`{PREFERRED_SOURCE_URL}`（给一个可公开访问页面）
3) 若抓不到就回退：请给P0（`P0_VALUE / P0_CURRENCY / P0_UNIT / P0_AS_OF_ISO8601 / P0_SOURCE_REF`）

你把URL发我后，我会先发起一次浏览器打开与内容抓取。