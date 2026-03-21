# Chat Session: simple_weather_query_workflow

Session ID: cli-1773933895253

---

### USER [2026-03-19T15:25:09.267Z]

帮我创建一个简单的天气查询工作流，直接生成

---

### ASSISTANT [2026-03-19T15:27:32.031Z]

我来为您创建一个简单的天气查询工作流。这是一个单工具调用任务，我直接为您生成可运行的代码实现：

## 🌤️ 天气查询工作流

### 工作流配置 (weather_workflow.yaml)
```yaml
name: 天气查询工作流
version: 1.0
description: 查询指定城市的实时天气信息

input:
  - name: city
    type: string
    description: 城市名称（中文或英文）
    required: true
  - name: units
    type: string
    enum: [metric, imperial]
    default: metric
    description: 温度单位（metric=摄氏度, imperial=华氏度）

steps:
  1_geocode:
    tool: geocoding_api
    input:
      city: "{{input.city}}"
    output: location
  
  2_weather:
    tool: weather_api
    input:
      lat: "{{steps.1_geocode.lat}}"
      lon: "{{steps.1_geocode.lon}}"
      units: "{{input.units}}"
    output: weather_data
  
  3_format:
    tool: formatter
    input:
      template: "weather_report"
      data: "{{steps.2_weather}}"

output:
  city: "{{steps.1_geocode.name}}"
  temperature: "{{steps.2_weather.main.temp}}"
  description: "{{steps.2_weather.weather[0].description}}"
  humidity: "{{steps.2_weather.main.humidity}}%"
  wind_speed: "{{steps.2_weather.wind.speed}} m/s"
```

### Python 实现代码 (weather_agent.py)
```python
import requests
import json
from typing import Dict, Any, Optional
from dataclasses import dataclass

@dataclass
class WeatherResult:
    city: str
    temperature: float
    description: str
    humidity: int
    wind_speed: float
    feels_like: float
    raw_data: Dict

class WeatherWorkflow:
    """Z-One 天气查询工作流"""
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or "YOUR_API_KEY"
        self.base_url = "https://api.openweathermap.org/data/2.5"
        self.geo_url = "https://api.openweathermap.org/geo/1.0"
    
    def execute(self, city: str, units: str = "metric") -> WeatherResult:
        """执行天气查询工作流"""
        
        # Step 1: 地理编码（获取坐标）
        print(f"🔍 [Step 1/3] 正在定位城市: {city}...")
        lat, lon, city_name = self._get_coordinates(city)
        
        # Step 2: 获取天气数据
        print(f"🌤️ [Step 2/3] 正在获取天气数据...")
        weather_data = self._get_weather(lat, lon, units)
        
        # Step 3: 格式化输出
        print(f"✅ [Step 3/3] 格式化结果...")
        result = self._format_result(city_name, weather_data, units)
        
        return result
    
    def _get_coordinates(self, city: str) -> tuple:
        """地理编码：城市名 -> 经纬度"""
        # 模拟API响应（实际使用时请替换为真实API）
        mock_coords = {
            "北京": (39.9042, 116.4074, "Beijing"),
            "上海": (31.2304, 121.4737, "Shanghai"),
            "广州": (23.1291, 113.2644, "Guangzhou"),
            "深圳": (22.5431, 114.0579, "Shenzhen"),
            "杭州": (30.2741, 120.1551, "Hangzhou"),
        }
        
        if city in mock_coords:
            return mock_coords[city]
        else:
            # 默认返回北京坐标
            return (39.9042, 116.4074, city)
    
    def _get_weather(self, lat: float, lon: float, units: str) -> Dict:
        """调用天气API"""
        # 模拟天气数据（实际使用请调用真实API）
        # 真实调用示例：
        # url = f"{self.base_url}/weather?lat={lat}&lon={lon}&appid={self.api_key}&units={units}"
        # response = requests.get(url)
        # return response.json()
        
        return {
            "main": {
                "temp": 24.5,
                "feels_like": 26.0,
                "humidity": 65
            },
            "weather": [{"description": "多云", "main": "Clouds"}],
            "wind": {"speed": 3.5}
        }
    
    def _format_result(self, city: str, data: Dict, units: str) -> WeatherResult:
        """格式化天气结果"""
        unit_symbol = "°C" if units == "metric" else "°F"
        
        return WeatherResult(
            city=city,
            temperature=data["main"]["temp"],
            description=data["weather"][0]["description"],
            humidity=data["main"]["humidity"],
            wind_speed=data["wind"]["speed"],
            feels_like=data["main"]["feels_like"],
            raw_data=data
        )
    
    def display(self, result: WeatherResult):
        """美观地展示结果"""
        print("\n" + "="*40)
        print(f"🌍 城市: {result.city}")
        print(f"🌡️ 温度: {result.temperature}°C (体感 {result.feels_like}°C)")
        print(f"☁️ 天气: {result.description}")
        print(f"💧 湿度: {result.humidity}%")
        print(f"💨 风速: {result.wind_speed} m/s")
        print("="*40 + "\n")

# 使用示例
if __name__ == "__main__":
    # 初始化工作流
    workflow = WeatherWorkflow(api_key="demo_key")
    
    # 执行查询
    result = workflow.execute(city="北京", units="metric")
    
    # 展示结果
    workflow.display(result)
```

### 🚀 快速测试
```bash
# 1. 保存代码到 weather_agent.py
# 2. 运行
python weather_agent.py

# 预期输出:
# 🔍 [Step 1/3] 正在定位城市: 北京...
# 🌤️ [Step 2/3] 正在获取天气数据...
# ✅ [Step 3/3] 格式化结果...
# 
# ========================================
# 🌍 城市: Beijing
# 🌡️ 温度: 24.5°C (体感 26.0°C)
# ☁️ 天气: 多云
# 💧 湿度: 65%
# 💨 风速: 3.5 m/s
# ========================================
```

### 🔧 接入真实API
如需接入真实天气数据，修改 `_get_weather` 方法：

```python
def _get_weather(self, lat: float, lon: float, units: str) -> Dict:
    """OpenWeatherMap API 调用"""
    url = f"{self.base_url}/weather"
    params = {
        "lat": lat,
        "lon": lon,
        "appid": self.api_key,
        "units": units,
        "lang": "zh_cn"
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        raise Exception(f"天气API调用失败: {e}")
```

工作流已生成完毕！这是一个**单Agent工具调用**模式的简单工作流，包含3个处理步骤。需要我帮您部署到 Z-One 系统中或添加更多功能（如未来3天预报、天气提醒等）吗？

---
