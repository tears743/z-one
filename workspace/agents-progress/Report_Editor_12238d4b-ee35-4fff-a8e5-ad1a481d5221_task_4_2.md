```json
{
  "intent_name": "黄金趋势报告（XAU/USD）- 结构化生成需求",
  "language": "zh-CN",
  "asset": {
    "name": "现货黄金",
    "symbol": "XAU/USD",
    "resolved_symbol": "OANDA:XAUUSD",
    "quote_currency": "USD",
    "unit": "美元/盎司"
  },
  "start_price": {
    "price": 5042.740,
    "timestamp_text": "At close at Feb 14, 05:59 GMT+8",
    "as_of_note": "页面显示 Market closed，为收盘快照（非连续实时）"
  },
  "report_structure_required": [
    "引言：包含当前价+时间戳+来源链接",
    "三段周期分析：每段必须含（趋势判断+核心逻辑+目标价），并给出上/下行情景",
    "结论：给出基准结论+上下行情景/风险点",
    "数据来源限制声明：若无实时行情，说明替代数据口径与可验证链接"
  ],
  "cycles": [
    {
      "horizon": "3个月",
      "label": "战术",
      "trend": "震荡（偏强）",
      "core_logic": [
        "降息预期反复、数据依赖导致利率路径重定价频繁",
        "实际利率（名义利率-通胀预期）小幅下行则利多黄金；若上行则压制",
        "美元在“利差交易+避险切换”间摇摆；地缘/尾部事件可抬升避险溢价",
        "短期价格弹性更多来自资金/仓位（ETF、投机仓位/CTA）与风险溢价，而非长期中枢重估"
      ],
      "target_price": {
        "base": 5200,
        "bull": 5600,
        "bear": 4600
      },
      "scenarios": [
        {
          "name": "基准",
          "drivers": ["美联储按兵不动为主", "实际利率高位震荡或小幅回落", "美元区间震荡", "风险事件不系统化但提供支撑"],
          "target": 5200
        },
        {
          "name": "上行",
          "drivers": ["降息预期提前/实际利率回落", "地缘风险溢价抬升", "ETF回流或仓位推动趋势加速"],
          "target": 5600
        },
        {
          "name": "下行",
          "drivers": ["通胀再黏导致降息后移", "美元走强", "实际利率上行+风险溢价退潮"],
          "target": 4600
        }
      ]
    },
    {
      "horizon": "1年",
      "label": "策略",
      "trend": "看涨",
      "core_logic": [
        "从限制性走向中性：进入降息周期（软着陆降息/衰退式降息分叉）",
        "名义利率趋势下行概率更高；决定黄金方向的关键在实际利率是否从高位回落",
        "若美国相对利差优势收敛，美元中枢偏弱将抬升金价中枢",
        "中期更依赖配置资金（ETF）+央行购金趋势+实际需求在回撤中的承接"
      ],
      "target_price": {
        "base": 5800,
        "bull": 6700,
        "bear": 4700
      },
      "scenarios": [
        {
          "name": "基准",
          "drivers": ["降息周期开启但节奏温和", "实际利率回落有限但方向向下", "美元不再系统性走强"],
          "target": 5800
        },
        {
          "name": "上行",
          "drivers": ["衰退式降息/或再通胀尾部", "财政与地缘尾部共振抬升风险溢价", "央行购金延续+ETF明显回流"],
          "target": 6700
        },
        {
          "name": "下行",
          "drivers": ["软着陆但实际利率中枢维持偏高", "美元偏强", "风险溢价回落且ETF资金缺席/流出"],
          "target": 4700
        }
      ]
    },
    {
      "horizon": "3年",
      "label": "结构",
      "trend": "看涨（高波动上行）",
      "core_logic": [
        "核心是实际利率中枢与通胀体制：若实际利率中枢下移或波动上升，黄金长期配置价值提高",
        "财政赤字/期限溢价与货币体系不确定性可能抬升黄金风险溢价（更高的“底”）",
        "储备多元化与央行购金是长期更“价格不敏感”的边际买家，决定长期中枢",
        "美元结构性走弱或储备偏好变化将增强黄金中枢上移的持续性"
      ],
      "target_price": {
        "base": 6800,
        "bull": 8500,
        "bear": 4800
      },
      "scenarios": [
        {
          "name": "基准",
          "drivers": ["实际利率中枢较当前下移但非线性", "央行购金维持净买入", "地缘与制度不确定性常态化带来底仓需求"],
          "target": 6800
        },
        {
          "name": "上行",
          "drivers": ["实际利率中枢显著下移", "去美元化/储备多元化加速", "尾部风险常态化导致风险溢价“常驻”"],
          "target": 8500
        },
        {
          "name": "下行",
          "drivers": ["实际利率长期维持显著正值", "美元结构性偏强", "风险溢价系统性压缩+央行购金放缓"],
          "target": 4800
        }
      ]
    }
  ],
  "final_conclusion_required": {
    "format": "明确结论：基准结论 + 上行情景 + 下行情景，并列出关键风险点/触发因素",
    "baseline_view": "短期震荡偏强；中期（1年）与长期（3年）中枢上移的概率更高，但需警惕实际利率与美元的反向约束",
    "key_risks": [
      "实际利率上行（最硬压制）",
      "美元趋势性走强（计价效应+非美需求走弱）",
      "风险偏好回升导致避险溢价退潮",
      "央行购金放缓（中长期支撑减弱）",
      "ETF持续流出/西方配置资金缺席",
      "通胀预期过快下行导致实利率不降反升"
    ]
  },
  "data_sources_and_limitations": {
    "primary_source": {
      "name": "TradingView（数据源标注为 OANDA）",
      "url": "https://www.tradingview.com/symbols/XAUUSD/",
      "fields_used": ["最新价", "币种单位", "页面时间戳"],
      "verifiability": "可通过页面公开展示字段复核（包含 last price 与 At close 时间戳）"
    },
    "secondary_source_status": {
      "status": "未完成校验",
      "plan": [
        "Investing: https://www.investing.com/currencies/xau-usd",
        "Kitco: https://www.kitco.com/price/precious-metals/gold"
      ],
      "disclosure_requirement": "若未取得第二来源，则报告必须声明：当前价为单一公开源“收盘快照/可能延迟”，仅作报告起点；目标价为情景建模用途"
    },
    "pricing_method_note": "在第二来源未验证前，不做跨源均值；如后续补齐双源且时间戳接近，可披露价差并说明主引用源选择与误差口径。"
  }
}
```