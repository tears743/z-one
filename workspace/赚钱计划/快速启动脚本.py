#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🚀 赚钱计划快速启动脚本
功能：自动生成宣传资料、计算定价、追踪进度
"""

import json
from datetime import datetime, timedelta
from typing import Dict, List

class MoneyMakingPlan:
    """赚钱计划执行助手"""
    
    def __init__(self):
        self.start_date = datetime.now()
        self.services = {
            "网站开发": {"price_range": (500, 5000), "delivery": "3-7天"},
            "自动化脚本": {"price_range": (200, 2000), "delivery": "1-3天"},
            "数据爬虫": {"price_range": (300, 3000), "delivery": "2-5天"},
            "技术咨询": {"price_range": (100, 500), "delivery": "预约制"},
            "小工具开发": {"price_range": (300, 1500), "delivery": "2-4天"}
        }
        self.earnings = []
    
    def generate_service_card(self, service_name: str) -> str:
        """生成服务卡片文案"""
        if service_name not in self.services:
            return "服务不存在"
        
        service = self.services[service_name]
        min_price, max_price = service["price_range"]
        
        card = f"""
╔══════════════════════════════════════╗
║     💼 {service_name}服务              ║
╠══════════════════════════════════════╣
║  💰 价格区间：{min_price}-{max_price}元              ║
║  ⏱️  交付周期：{service["delivery"]:<12}           ║
║  ✅ 质量保证，售后支持               ║
║  📩 欢迎咨询，免费评估需求！         ║
╚══════════════════════════════════════╝
        """
        return card
    
    def calculate_pricing(self, hours: int, complexity: str = "medium") -> Dict:
        """计算项目定价建议"""
        hourly_rates = {
            "low": 50,      # 简单任务
            "medium": 100,  # 中等复杂度
            "high": 200     # 高复杂度
        }
        
        rate = hourly_rates.get(complexity, 100)
        base_price = hours * rate
        
        # 建议定价区间
        return {
            "保守价": int(base_price * 0.8),
            "标准价": base_price,
            "溢价": int(base_price * 1.3),
            "时薪": rate
        }
    
    def generate_promo_post(self) -> str:
        """生成推广文案"""
        return """
🔥 专业开发服务，助你解决问题！

我能为你做什么？
✅ 网站开发 - 从展示页到完整系统
✅ 自动化脚本 - 提升工作效率10倍
✅ 数据爬虫 - 获取你想要的任何数据
✅ 技术咨询 - 一对一专业指导

为什么选择我？
⭐ 3年+开发经验
⭐ 100+项目交付
⭐ 快速响应，高效交付
⭐ 代码规范，易于维护

💬 现在咨询，首单享9折优惠！
📮 私信了解更多详情~

#程序员 #接单 #开发 #技术外包
        """.strip()
    
    def track_earning(self, source: str, amount: float, description: str = ""):
        """记录收入"""
        earning = {
            "date": datetime.now().strftime("%Y-%m-%d"),
            "source": source,
            "amount": amount,
            "description": description
        }
        self.earnings.append(earning)
        print(f"✅ 已记录收入：{source} +{amount}元")
    
    def get_progress_report(self) -> str:
        """获取进度报告"""
        days_running = (datetime.now() - self.start_date).days + 1
        total_earnings = sum(e["amount"] for e in self.earnings)
        
        report = f"""
📊 赚钱计划进度报告
═══════════════════════════════════
⏱️  运行天数：{days_running}天
💰 累计收入：{total_earnings:.2f}元
📦 订单数量：{len(self.earnings)}笔
📈 日均收入：{total_earnings/max(days_running,1):.2f}元
═══════════════════════════════════

🎯 本周目标：
□ 注册5个平台 (0/5)
□ 发布2个服务 (0/2)  
□ 获得首笔收入 ({len(self.earnings)}/1)

💪 继续加油！
        """
        return report
    
    def generate_daily_plan(self) -> str:
        """生成每日行动计划"""
        return """
📋 今日行动清单

🌅 上午 (9:00-12:00)
  □ 查看并回复所有咨询
  □ 处理现有项目进度
  □ 发布/更新服务内容

🌞 下午 (14:00-18:00)
  □ 开发/交付工作
  □ 学习新技术/案例
  □ 主动寻找新客户

🌙 晚上 (20:00-22:00)
  □ 内容创作/社交媒体
  □ 记录今日收支
  □ 规划明日任务

🔥 重点提示：
1. 优先处理付费客户的需求
2. 每天至少发布一条内容
3. 保持与潜在客户的互动
        """


def main():
    """主函数 - 启动赚钱计划"""
    print("=" * 50)
    print("🚀 赚钱计划快速启动器")
    print("=" * 50)
    
    plan = MoneyMakingPlan()
    
    # 展示服务卡片
    print("\n📦 你的服务产品：")
    print(plan.generate_service_card("网站开发"))
    print(plan.generate_service_card("自动化脚本"))
    
    # 定价计算示例
    print("\n💰 定价计算器（示例：10小时中等复杂度项目）：")
    pricing = plan.calculate_pricing(10, "medium")
    for key, value in pricing.items():
        print(f"  {key}: {value}元")
    
    # 推广文案
    print("\n📝 推广文案模板：")
    print(plan.generate_promo_post())
    
    # 进度报告
    print(plan.get_progress_report())
    
    # 每日计划
    print(plan.generate_daily_plan())
    
    print("\n" + "=" * 50)
    print("✅ 启动完成！开始你的赚钱之旅吧！")
    print("=" * 50)


if __name__ == "__main__":
    main()
