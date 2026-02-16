下面给你一套“可按用户选择生成/调整”的 **数据来源、时间戳、价格锚点、风险提示/免责声明** 段落方案，并明确 **插入位置（开头/结尾/脚注）** 与可替换占位符。你只要给我用户勾选项（或直接说“默认”），我就能把对应段落落到报告里。

---

## 1) 用户选择项（用于驱动生成）
### A. 段落组件开关
- `include_source`：是/否（数据来源）
- `include_timestamp`：是/否（数据截至/采集时间 + 时区）
- `price_anchor_mode`：`P0` / `LATEST` / `NONE`
- `include_risk_disclaimer`：是/否（风险提示/免责声明）

### B. 插入位置选择（四选一）
- `placement`：`开头` / `结尾` / `脚注` / `开头+脚注`

> 建议默认：对外发布用 `开头+脚注`；内部周报可用 `结尾`；长报告（含目录/附录）通常用 `脚注` 或 `结尾`。

---

## 2) 生成的段落模板（可审计、简洁）
### 2.1 数据来源（Source）
**模板（可单独出现）**
> **数据来源：**{SOURCE_LIST}。如涉及第三方数据，其版权与解释权归原提供方所有。

**占位符**
- `{SOURCE_LIST}`：例如 `Bloomberg、Wind、Reuters、COMEX/ICE/SHFE交易所公告、各央行官网、世界黄金协会（WGC）`

---

### 2.2 时间戳（As-of / Observed）
**模板（推荐写法：说明“截至时间+时区”）**
> **数据时间戳：**除非另有说明，文中数据截至/采集时间为 {AS_OF_ISO8601}（{TZ}）。

**占位符**
- `{AS_OF_ISO8601}`：如 `2026-02-14T01:35:22Z` 或 `2026-02-14T09:35:22+08:00`
- `{TZ}`：如 `UTC` / `UTC+8`

---

### 2.3 价格锚点（Price Anchor）
#### A) 选 P0（固定基准价）
> **价格锚点（P0）：**本报告以P0作为统一比较基准。P0取自 {P0_SOURCE_TYPE} 记录（引用：{P0_SOURCE_REF}），为 {P0_VALUE} {P0_CURRENCY}（单位：{P0_UNIT}），对应时点 {P0_AS_OF_ISO8601}。P0为固定输入值，用于口径统一，后续价格波动不改变其定义与取值。

#### B) 选 最新价（LATEST）
> **价格锚点（最新价）：**本报告采用可获取的最新价格作为锚点：{LATEST_VALUE} {LATEST_CURRENCY}（单位：{LATEST_UNIT}），来源 {LATEST_SOURCE_NAME}（{LATEST_SOURCE_URL}）。本次采集时间 observed_at={LATEST_OBSERVED_AT_ISO8601}；如来源提供报价/更新时间，则 quoted_at={LATEST_QUOTED_AT_ISO8601}（未提供则以observed_at为准）。市场价格实时变动，不同时间点展示值可能存在差异。

#### C) 选 NONE（不写具体价）
> **价格口径：**如未特别标注，文中价格相关表述以区间/相对变化描述，不构成对任何具体成交价格的承诺或保证。

---

### 2.4 风险提示/免责声明（合规版，偏研究报告）
> **风险提示与免责声明：**本材料仅供信息交流与研究参考，不构成任何形式的投资建议、要约、邀约或承诺。市场有风险，投资需谨慎。历史表现不代表未来表现，任何预测均基于公开信息与假设，可能因宏观环境、流动性、政策与事件变化而调整。作者/机构不对因使用本材料所导致的任何直接或间接损失承担责任。读者应结合自身风险承受能力，必要时咨询持牌机构或专业人士。

（如需更强版本，可再加一句：“不构成个别化/适当性匹配意见”。）

---

## 3) 插入位置规则（你给一个 placement，我按规则落位）
### placement = 开头
- 放在 **标题区块（版本/日期/数据来源）之后**、目录之前，作为 “声明块（Disclosure）”。

### placement = 结尾
- 放在 **“七、风险提示”章节**中（替换占位符），并在末尾追加 “数据来源+时间戳+价格锚点”小节；或放在全文最后、附录之后的 “免责声明”小节。

### placement = 脚注
- 在首页（标题下）放一行脚注引用：
  - `[^disclosure]`
- 文末追加脚注内容（Markdown脚注区）：
  - `[^disclosure]: ...（拼接来源/时间戳/锚点/免责声明）`

### placement = 开头+脚注（推荐对外）
- 开头放 **精简版（1-2行）**；脚注放 **完整版（可审计字段齐全）**。

---

## 4) 你只需补齐的最少信息（否则我用占位符保留）
1) `placement` 选哪个  
2) `price_anchor_mode`：P0 / LATEST / NONE  
- 若 P0：给 `{P0_VALUE}{P0_CURRENCY}{P0_UNIT}{P0_AS_OF_ISO8601}{P0_SOURCE_TYPE}{P0_SOURCE_REF}`
- 若 LATEST：给 `{LATEST_VALUE}{LATEST_CURRENCY}{LATEST_UNIT}{LATEST_OBSERVED_AT_ISO8601}{LATEST_SOURCE_NAME}{LATEST_SOURCE_URL}`（`quoted_at/hash`可选）
3) `AS_OF_ISO8601` 与时区（若 include_timestamp=是）
4) `SOURCE_LIST`（若 include_source=是）
5) 风险提示强度：`标准/增强/弱化`（默认=标准）

把用户的选择用下面格式发我即可：
```yaml
placement: 开头+脚注
include_source: 是
include_timestamp: 是
price_anchor_mode: LATEST
include_risk_disclaimer: 是
risk_level: 标准
AS_OF_ISO8601: 2026-02-14T01:35:22Z
TZ: UTC
SOURCE_LIST: Bloomberg, Wind, WGC
LATEST_VALUE: 2034.2
LATEST_CURRENCY: USD
LATEST_UNIT: USD/oz
LATEST_OBSERVED_AT_ISO8601: 2026-02-14T01:35:22Z
LATEST_SOURCE_NAME: Bloomberg
LATEST_SOURCE_URL: https://...
```