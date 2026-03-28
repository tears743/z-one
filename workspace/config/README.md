# Competitor Configuration System

## Overview

This configuration system defines extraction rules, request parameters, and anti-detection strategies for scraping competitor e-commerce sites. The configuration uses JSON format for easy editing and version control.

## File Structure

```
config/
├── competitors.json    # Main configuration file
├── README.md          # This documentation
└── schemas/           # JSON schemas for validation (optional)
```

## Quick Start

1. Enable a competitor by setting `"enabled": true`
2. Customize selectors based on the target site's HTML structure
3. Adjust rate limiting to respect the site's tolerance
4. Test with a single product URL before bulk scraping

## Configuration Schema

### Top-Level Structure

```json
{
  "_schema_version": "1.0.0",
  "_description": "Description of this config file",
  "_last_updated": "YYYY-MM-DD",
  "competitors": {
    "competitor_key": { /* Competitor configuration */ }
  },
  "global_settings": { /* Default settings */ }
}
```

### Competitor Configuration Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable competitor name |
| `base_url` | string | Yes | Root URL of the competitor site |
| `enabled` | boolean | Yes | Whether this competitor is active |
| `selectors` | object | Yes | CSS selectors for data extraction |
| `currency` | object | Yes | Currency handling rules |
| `request_config` | object | Yes | HTTP request parameters |
| `retry_config` | object | Yes | Retry and backoff settings |
| `rate_limiting` | object | Yes | Rate limiting configuration |
| `anti_detection` | object | No | Anti-bot detection evasion |

## Selector Configuration

### Price Selectors

```json
"price": {
  "primary": "#priceblock_dealprice",
  "fallbacks": ["#priceblock_ourprice", ".a-price .a-offscreen"],
  "attribute": "textContent",
  "regex_pattern": "\\$?([0-9,]+\\.?[0-9]*)",
  "currency_symbol": "$"
}
```

| Property | Description |
|----------|-------------|
| `primary` | Main CSS selector to try first |
| `fallbacks` | Array of backup selectors if primary fails |
| `attribute` | HTML attribute to extract (e.g., `textContent`, `innerHTML`, `data-price`) |
| `regex_pattern` | Regex to extract numeric value from text |
| `currency_symbol` | Expected currency symbol (optional) |

### Product Name Selectors

```json
"product_name": {
  "primary": "#productTitle",
  "fallbacks": ["#title", "h1"],
  "attribute": "textContent",
  "strip_whitespace": true,
  "max_length": 255
}
```

### Availability Detection

```json
"availability": {
  "selector": "#availability span",
  "in_stock_keywords": ["in stock", "available"],
  "out_of_stock_keywords": ["out of stock", "unavailable"]
}
```

## Adding a New Competitor

### Step-by-Step Guide

1. **Analyze the target site:**
   ```bash
   # Use browser dev tools to inspect elements
   # Identify:
   # - Price element and its CSS selector
   # - Product name selector
   # - Availability indicator
   # - Any dynamic loading behavior
   ```

2. **Create a new entry in `competitors.json`:**

```json
"my_new_competitor": {
  "name": "My New Competitor",
  "base_url": "https://www.newcompetitor.com",
  "enabled": true,
  
  "selectors": {
    "product_page": {
      "price": {
        "primary": ".price-current",
        "fallbacks": [".price-sale", ".price"],
        "attribute": "textContent",
        "regex_pattern": "\\$?([0-9,]+\\.?[0-9]*)",
        "currency_symbol": "$"
      },
      "product_name": {
        "primary": "h1.product-name",
        "fallbacks": [".product-title"],
        "attribute": "textContent",
        "strip_whitespace": true,
        "max_length": 255
      },
      "availability": {
        "selector": ".stock-status",
        "in_stock_keywords": ["in stock", "available now"],
        "out_of_stock_keywords": ["out of stock", "sold out", "unavailable"]
      },
      "image": {
        "primary": ".product-image img",
        "attribute": "src"
      }
    },
    "search_results": {
      "product_container": ".product-item",
      "price": ".product-price",
      "product_name": ".product-title",
      "link": ".product-link",
      "image": ".product-image"
    }
  },
  
  "currency": {
    "code": "USD",
    "symbol": "$",
    "position": "prefix",
    "thousands_separator": ",",
    "decimal_separator": "."
  },
  
  "request_config": {
    "headers": {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "DNT": "1",
      "Connection": "keep-alive"
    },
    "timeout_seconds": 30,
    "follow_redirects": true,
    "max_redirects": 5
  },
  
  "retry_config": {
    "max_retries": 3,
    "retry_delay_seconds": 2,
    "backoff_multiplier": 2,
    "retry_on_status_codes": [429, 500, 502, 503, 504],
    "retry_on_exceptions": ["TimeoutError", "ConnectionError"]
  },
  
  "rate_limiting": {
    "requests_per_minute": 30,
    "delay_between_requests_ms": 2000,
    "jitter_ms": 500
  }
}
```

3. **Test your configuration:**
   ```python
   # Example test script
   import json
   
   with open('config/competitors.json') as f:
       config = json.load(f)
   
   competitor = config['competitors']['my_new_competitor']
   print(f"Testing {competitor['name']}")
   print(f"Price selector: {competitor['selectors']['product_page']['price']['primary']}")
   ```

## Selector Discovery Tips

### Finding the Right Selector

1. **Right-click → Inspect Element** in Chrome/Edge
2. **Look for stable attributes:**
   - Prefer: `id`, `data-*` attributes
   - Avoid: Random class names like `.css-1x2a3b4`
   - Use: Semantic class names like `.product-price`, `#price`

3. **XPath as fallback:**
   ```json
   "primary": "xpath://div[@id='price']/span[contains(@class, 'amount')]"
   ```

4. **Test selector specificity:**
   ```javascript
   // In browser console
   document.querySelector('.price')  // Returns first match
   document.querySelectorAll('.price')  // Returns all matches
   ```

### Handling Dynamic Content

For sites using React/Vue/Angular:

```json
"price": {
  "primary": "[data-testid='product-price']",
  "wait_for": "visible",
  "timeout_ms": 5000
}
```

### CSS Selector Reference

| Pattern | Meaning | Example |
|---------|---------|---------|
| `#id` | Element with ID | `#price` |
| `.class` | Element with class | `.product-price` |
| `[attr]` | Has attribute | `[data-price]` |
| `[attr='val']` | Attribute equals | `[data-testid='price']` |
| `parent > child` | Direct child | `.product > .price` |
| `ancestor descendant` | Any descendant | `.product .price` |
| `:nth-child(n)` | Nth child | `li:nth-child(2)` |
| `:contains('text')` | Contains text | `span:contains('USD')` |

## Request Headers Best Practices

### Avoiding Detection

```json
"request_config": {
  "headers": {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.google.com/search?q=product",
    "DNT": "1"
  }
}
```

### Mobile User Agents (Alternative)

```json
"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
```

## Retry Configuration

### Exponential Backoff

```json
"retry_config": {
  "max_retries": 3,
  "retry_delay_seconds": 2,
  "backoff_multiplier": 2
}
```

This creates delays of: 2s, 4s, 8s between retries.

### When to Retry

```json
"retry_on_status_codes": [429, 500, 502, 503, 504],
"retry_on_exceptions": ["TimeoutError", "ConnectionError", "HTTPError"]
```

| Status Code | Meaning | Should Retry? |
|-------------|---------|---------------|
| 429 | Too Many Requests | Yes, with backoff |
| 500 | Internal Server Error | Yes |
| 502 | Bad Gateway | Yes |
| 503 | Service Unavailable | Yes |
| 504 | Gateway Timeout | Yes |
| 403 | Forbidden | No (likely blocked) |
| 404 | Not Found | No |

## Rate Limiting Guidelines

### Conservative Settings

```json
"rate_limiting": {
  "requests_per_minute": 20,
  "delay_between_requests_ms": 3000,
  "jitter_ms": 1000
}
```

### Aggressive Settings (Use with caution)

```json
"rate_limiting": {
  "requests_per_minute": 60,
  "delay_between_requests_ms": 800,
  "jitter_ms": 200
}
```

### Site-Specific Recommendations

| Site Type | Requests/Min | Delay (ms) |
|-----------|--------------|------------|
| Large retail (Amazon) | 20-30 | 2000-3000 |
| Mid-size e-commerce | 30-45 | 1500-2000 |
| Small Shopify stores | 40-60 | 1000-1500 |
| API endpoints | 60-120 | 500-1000 |

## Currency Handling

### Auto-Detection

```json
"currency": {
  "code": "AUTO_DETECT",
  "auto_detection_patterns": {
    "USD": ["\\$", "USD"],
    "EUR": ["€", "EUR"],
    "GBP": ["£", "GBP"]
  }
}
```

### Fixed Currency

```json
"currency": {
  "code": "EUR",
  "symbol": "€",
  "position": "suffix",
  "thousands_separator": ".",
  "decimal_separator": ","
}
```

Note: European format uses `.` for thousands and `,` for decimals.

## Validation

### JSON Schema Validation

You can validate your configuration using JSON Schema:

```bash
# Install jsonschema
pip install jsonschema

# Validate
jsonschema -i config/competitors.json config/schemas/competitor-schema.json
```

### Pre-deployment Checklist

- [ ] All selectors tested on live site
- [ ] Fallback selectors in place
- [ ] Rate limits are conservative initially
- [ ] Retry logic configured for transient errors
- [ ] Currency format matches site locale
- [ ] User-Agent is realistic
- [ ] `enabled` flag set correctly

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Selectors return null | Check for dynamic content, add wait time |
| Price parsing fails | Verify regex pattern matches site format |
| 403 Forbidden | Rotate User-Agent, add delays, use proxies |
| Timeout errors | Increase `timeout_seconds`, check site availability |
| Inconsistent results | Use multiple fallback selectors |
| Blocked after few requests | Reduce rate limits, increase delays |

### Debug Mode

Enable detailed logging for troubleshooting:

```json
"debug": {
  "log_selector_matches": true,
  "save_failed_html": true,
  "screenshot_on_failure": true
}
```

## Examples Reference

### Example 1: Amazon-Style Site

Complex selectors with multiple fallbacks, strict rate limiting.

### Example 2: Shopify Store

Standard Shopify structure, JSON-LD extraction, API endpoints.

### Example 3: Generic Template

Flexible auto-detection, customizable for any site.

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-21 | Initial release with 3 example configurations |

## Support

For questions or issues:
1. Check selector syntax using browser dev tools
2. Verify JSON syntax using a validator
3. Test with minimal configuration first
4. Review site terms of service before scraping
