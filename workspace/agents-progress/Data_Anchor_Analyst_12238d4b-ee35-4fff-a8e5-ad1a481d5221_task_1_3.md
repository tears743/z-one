## 1) 价格锚点字段规范（建议作为报告/数据表的统一Schema）

### A. P0（基准价/锚定价）输入格式（人工或内部系统提供）
> 目标：P0必须“可复现、可审计”，不依赖后续价格波动。

**必填字段**
- `price_anchor.mode`：固定为 `"P0"`
- `price_anchor.P0.value`：数值（建议小数点最多6位，按品类约束）
- `price_anchor.P0.currency`：ISO 4217（如 `"CNY"`, `"USD"`, `"EUR"`）
- `price_anchor.P0.as_of`：ISO8601 时间戳（例如 `2026-02-14T09:30:00+08:00` 或 `2026-02-14T01:30:00Z`）
- `price_anchor.P0.source_type`：枚举（`"manual" | "internal_system" | "contract" | "invoice" | "quote"`)
- `price_anchor.P0.source_ref`：可审计引用（合同号/报价单号/工单号/系统记录ID等）
- `price_anchor.P0.unit`：计价单位（如 `"per_ton"`, `"per_unit"`, `"per_kWh"` 或 `"CNY/吨"`，二选一但需统一）

**强烈建议字段**
- `price_anchor.P0.notes`：补充说明（口径、含税/不含税、运费、交割地、最小起订量等）
- `price_anchor.P0.tax_included`：布尔或枚举（`"included" | "excluded" | "unknown"`）
- `price_anchor.P0.incoterms` / `delivery_terms`：如适用

**格式示例（JSON）**
```json
{
  "price_anchor": {
    "mode": "P0",
    "P0": {
      "value": 1234.56,
      "currency": "CNY",
      "unit": "CNY/吨",
      "as_of": "2026-02-14T09:30:00+08:00",
      "source_type": "internal_system",
      "source_ref": "ERP:PO-20260214-001",
      "tax_included": "excluded",
      "notes": "华东到厂，不含运费；结算口径=当月合同价"
    }
  }
}
```

---

### B. 最新价（Latest / 可获取最新报价）字段规范（可抓取/可回溯）
> 目标：记录“抓取时刻（采集时刻）”与“价格对应时点（报价时点）”并存，避免混淆。

**必填字段**
- `price_anchor.mode`：固定为 `"LATEST"`
- `price_anchor.latest.value`
- `price_anchor.latest.currency`
- `price_anchor.latest.unit`
- `price_anchor.latest.observed_at`：采集/抓取时间（ISO8601，**系统生成**，带时区，建议UTC：`...Z`）
- `price_anchor.latest.source_url`：来源链接（可公开访问或内网可访问）
- `price_anchor.latest.source_name`：来源名称（站点/数据提供商/交易所）
- `price_anchor.latest.source_method`：枚举（`"api" | "web_scrape" | "manual_capture" | "file_import"`）
- `price_anchor.latest.source_capture_hash`：可审计快照指纹（对原始响应/页面HTML/JSON做hash，如SHA256）

**强烈建议字段（用于“价格时点”对齐）**
- `price_anchor.latest.quoted_at`：报价发布时间/交易时段结束时间（若来源提供则填；不提供则留空）
- `price_anchor.latest.market`：市场/交易所/地区
- `price_anchor.latest.symbol`：标的代码（如期货合约、股票代码、商品代码）
- `price_anchor.latest.raw_value`：原始字段值（字符串），用于避免解析误差争议
- `price_anchor.latest.parse_rule`：解析规则版本（便于后续复现）

**格式示例（JSON）**
```json
{
  "price_anchor": {
    "mode": "LATEST",
    "latest": {
      "value": 98.73,
      "currency": "USD",
      "unit": "USD/bbl",
      "observed_at": "2026-02-14T01:35:22Z",
      "quoted_at": "2026-02-14T01:30:00Z",
      "source_name": "Example Data Provider",
      "source_url": "https://example.com/price/WTI",
      "source_method": "web_scrape",
      "source_capture_hash": "sha256:3b2f...9c",
      "symbol": "WTI",
      "raw_value": "98.73"
    }
  }
}
```

---

## 2) 若取最新价：抓取/记录时间与来源链接的策略（可直接落地）

### 时间戳（ISO8601）双时间策略
- `observed_at`（必填）：**你实际抓取/读取到数据的时间**  
  - 由采集系统写入；建议UTC（`Z`结尾）
  - 示例：`2026-02-14T01:35:22Z`
- `quoted_at`（可选但推荐）：**价格在来源侧对应的“报价/发布时间/结算时间”**  
  - 若页面/API返回“更新时间”“收盘时间”“时间戳”，则解析并写入
  - 若来源无此字段：留空，并在声明中说明“以observed_at为准”

### 来源与可审计性
- `source_url`：必须为可复查链接（最好带参数、锚点到具体品种页面）
- `source_capture_hash`：对原始API响应体或页面HTML做hash；必要时存档原文到对象存储，并记录：
  - `source_archive_url`（可选）：内部存证文件链接
- `source_method`：
  - API：记录endpoint、query参数、响应字段路径（放入`parse_rule`）
  - Web：记录CSS selector/XPath/正则（放入`parse_rule`）

---

## 3) 可插入报告的“声明段落”（两套：P0 / 最新价）

### 声明模板（P0）
> **价格锚点（P0）声明：**本报告采用P0作为基准价格锚点。P0取自{P0_SOURCE_TYPE}记录（引用：{P0_SOURCE_REF}），金额为{P0_VALUE} {P0_CURRENCY}（单位：{P0_UNIT}），对应时点为{P0_AS_OF_ISO8601}。P0为固定输入值，用于统一口径对比；后续市场价格波动不影响本报告中P0的定义与取值。

### 声明模板（最新价）
> **价格锚点（最新价）声明：**本报告采用可获取的最新价格作为锚点，价格为{LATEST_VALUE} {LATEST_CURRENCY}（单位：{LATEST_UNIT}）。数据来源为{LATEST_SOURCE_NAME}（链接：{LATEST_SOURCE_URL}）。本次采集时间（observed_at）为{LATEST_OBSERVED_AT_ISO8601}；若来源提供报价/更新时间，则对应quoted_at为{LATEST_QUOTED_AT_ISO8601}（如未提供则以observed_at为准）。由于市场价格实时变动，同一来源在不同时间点的展示值可能存在差异。

---

## 4) 可复用字段占位符（建议统一命名，便于自动替换）

### P0占位符
- `{P0_VALUE}`
- `{P0_CURRENCY}`
- `{P0_UNIT}`
- `{P0_AS_OF_ISO8601}`
- `{P0_SOURCE_TYPE}`
- `{P0_SOURCE_REF}`
- `{P0_TAX_INCLUDED}`（可选）
- `{P0_NOTES}`（可选）

### 最新价占位符
- `{LATEST_VALUE}`
- `{LATEST_CURRENCY}`
- `{LATEST_UNIT}`
- `{LATEST_OBSERVED_AT_ISO8601}`
- `{LATEST_QUOTED_AT_ISO8601}`（可为空）
- `{LATEST_SOURCE_NAME}`
- `{LATEST_SOURCE_URL}`
- `{LATEST_SOURCE_METHOD}`
- `{LATEST_SOURCE_CAPTURE_HASH}`

---

## 5) 口径强约束（建议写入团队规范）
- **必须区分**：`observed_at`（采集时刻）≠ `quoted_at`（报价时点）
- **必须带时区**：所有ISO8601时间戳必须包含`Z`或`±hh:mm`
- **必须可追溯**：最新价必须提供`source_url` + `source_capture_hash`（或等价存证）

如你给出具体品类/标的（例如“黄金现货”“某交易所期货合约”“电价”“某电商SKU”）与可用来源（API/网页），我可以把`parse_rule`字段（JSONPath/CSS选择器）也一并固化成可执行的抓取规范版本。