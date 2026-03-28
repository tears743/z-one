# Task Progress: Price_Intelligence_Officer

**Task ID**: task_1_1
**Session ID**: e990d4ec-f798-44e8-abe2-d6f0fadf75f0
**Status**: completed
**Time**: 2026-03-21T18:49:40.825Z

## Task Description
Define competitor monitoring targets. Create a configuration file (competitors.json) containing target URLs, product identifiers, and CSS selectors for price elements. If specific competitors aren't provided by the user, create a configurable template structure with examples.

## Result
I'll create a comprehensive competitor monitoring configuration file with a template structure and realistic examples from various e-commerce platforms.

```json
{
  "competitors": [
    {
      "id": "amazon_example",
      "name": "Amazon",
      "baseUrl": "https://www.amazon.com",
      "region": "US",
      "currency": "USD",
      "products": [
        {
          "productId": "B08N5WRWNW",
          "productName": "Sony WH-1000XM4 Headphones",
          "url": "https://www.amazon.com/dp/B08N5WRWNW",
          "selectors": {
            "price": {
              "current": "#priceblock_dealprice, #priceblock_ourprice, .a-price .a-offscreen",
              "list": ".a-price.a-text-price .a-offscreen",
              "sale": "#priceblock_saleprice"
            },
            "availability": "#availability span",
            "title": "#productTitle",
            "rating": ".a-icon-alt"
          },
          "pricePatterns": {
            "cleanup": "[^0-9.]",
            "decimal": "."
          }
        },
        {
          "productId": "B09V3KXJPB",
          "productName": "Apple MacBook Air M2",
          "url": "https://www.amazon.com/dp/B09V3KXJPB",
          "selectors": {
            "price": {
              "current": "#priceblock_dealprice, #priceblock_ourprice, .a-price .a-offscreen",
              "list": ".a-price.a-text-price .a-offscreen",
              "sale": "#priceblock_saleprice"
            },
            "availability": "#availability span",
            "title": "#productTitle",
            "rating": ".a-icon-alt"
          },
          "pricePatterns": {
            "cleanup": "[^0-9.]",
            "decimal": "."
          }
        }
      ],
      "headers": {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      "rateLimit": {
        "requestsPerMinute": 10,
        "delayBetweenRequests": 6000
      }
    },
    {
      "id": "walmart_example",
      "name": "Walmart",
      "baseUrl": "https://www.walmart.com",
      "region": "US",
      "currency": "USD",
      "products": [
        {
          "productId": "493244223",
          "productName": "Samsung 55\" Class 4K Crystal UHD",
          "url": "https://www.walmart.com/ip/493244223",
          "selectors": {
            "price": {
              "current": "[data-automation-id='product-price'] span[itemprop='price'], [data-testid='price-current']",
              "list": "[data-automation-id='product-price'] span:not([itemprop='price'])",
              "unit": "[data-automation-id='product-price'] .price-per-unit"
            },
            "availability": "[data-automation-id='availability-message']",
            "title": "h1[itemprop='name']",
            "rating": "[data-testid='reviews-section']"
          },
          "pricePatterns": {
            "cleanup": "[^0-9.]",
            "decimal": "."
          }
        }
      ],
      "headers": {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      "rateLimit": {
        "requestsPerMinute": 15,
        "delayBetweenRequests": 4000
      }
    },
    {
      "id": "bestbuy_example",
      "name": "Best Buy",
      "baseUrl": "https://www.bestbuy.com",
      "region": "US",
      "currency": "USD",
      "products": [
        {
          "productId": "6517058",
          "productName": "Nintendo Switch OLED Model",
          "url": "https://www.bestbuy.com/site/nintendo-switch-oled-model-w-neon-red-neon-blue-joy-con/6517058.p",
          "selectors": {
            "price": {
              "current": ".sr-only:contains('current price') + .visuallyhidden, .pricing-current-price .sr-only, .pricing-price__range-current",
              "list": ".pricing-price__range-regular",
              "sale": ".pricing-price__range-current"
            },
            "availability": ".fulfillment-add-to-cart-button button, .fulfillment-fulfillment-summary",
            "title": ".sku-title h1",
            "rating": ".sr-only:contains('out of 5 stars')"
          },
          "pricePatterns": {
            "cleanup": "[^0-9.]",
            "decimal": "."
          }
        }
      ],
      "headers": {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      "rateLimit": {
        "requestsPerMinute": 12,
        "delayBetweenRequests": 5000
      }
    },
    {
      "id": "target_example",
      "name": "Target",
      "baseUrl": "https://www.target.com",
      "region": "US",
      "currency": "USD",
      "products": [
        {
          "productId": "88368442",
          "productName": "Dyson V15 Detect Vacuum",
          "url": "https://www.target.com/p/dyson-v15-detect-cordless-vacuum/-/A-88368442",
          "selectors": {
            "price": {
              "current": "[data-test='product-price'] span, .h-text-red span",
              "list": "[data-test='product-price'] [data-test='regular-price']",
              "sale": "[data-test='product-price'] [data-test='sale-price']"
            },
            "availability": "[data-test='availability-status']",
            "title": "[data-test='product-title']",
            "rating": "[data-test='rating-value']"
          },
          "pricePatterns": {
            "cleanup": "[^0-9.]",
            "decimal": "."
          }
        }
      ],
      "headers": {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      "rateLimit": {
        "requestsPerMinute": 10,
        "delayBetweenRequests": 6000
      }
    },
    {
      "id": "newegg_example",
      "name": "Newegg",
      "baseUrl": "https://www.newegg.com",
      "region": "US",
      "currency": "USD",
      "products": [
        {
          "productId": "N82E16820232892",
          "productName": "Intel Core i9-13900K",
          "url": "https://www.newegg.com/intel-core-i9-13900k/p/N82E16820232892",
          "selectors": {
            "price": {
              "current": ".price-current strong, .price-current .price-current-num",
              "list": ".price-was",
              "sale": ".price-current",
              "shipping": ".price-ship"
            },
            "availability": ".product-inventory",
            "title": ".product-title",
            "rating": ".item-rating"
          },
          "pricePatterns": {
            "cleanup": "[^0-9.]",
            "decimal": "."
          }
        }
      ],
      "headers": {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      "rateLimit": {
        "requestsPerMinute": 20,
        "delayBetweenRequests": 3000
      }
    }
  ],
  "globalSettings": {
    "defaultHeaders": {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "gzip, deflate, br",
      "DNT": "1",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1"
    },
    "proxySettings": {
      "enabled": false,
      "rotation": "round-robin",
      "retryFailed": true
    },
    "monitoring": {
      "schedule": "0 */6 * * *",
      "timezone": "America/New_York",
      "alertThresholds": {
        "priceDrop": 5,
        "priceDropPercentage": 10,
        "stockAlert": true
      },
      "dataRetention": {
        "priceHistory": "365",
        "logs": "90"
      }
    },
    "notifications": {
      "channels": ["email", "webhook", "slack"],
      "emailRecipients": ["pricing-team@company.com"],
      "webhookUrl": "https://hooks.company.com/pricing-alerts",
      "slackChannel": "#pricing-alerts"
    }
  },
  "selectors": {
    "commonPatterns": {
      "price": {
        "amazon": "#priceblock_dealprice, #priceblock_ourprice, .a-price .a-offscreen, .a-price-whole",
        "walmart": "[data-automation-id='product-price'] span[itemprop='price'], [data-testid='price-current']",
        "bestbuy": ".sr-only:contains('current price') + .visuallyhidden, .pricing-current-price .sr-only",
        "target": "[data-test='product-price'] span, .h-text-red span",
        "newegg": ".price-current strong, .price-current .price-current-num",
        "ebay": "#prcIsum, #mm-saleDscPrc",
        "homedepot": "#standard-price, .price-format__main-price",
        "lowes": "[data-selector='pd-price-label'], .pricing-price__range-current",
        "costco": "#pull-right-price, .price",
        "generic": ".price, .product-price, [class*='price'], [data-price], .sale-price, .current-price"
      },
      "availability": {
        "amazon": "#availability span, #outOfStock",
        "walmart": "[data-automation-id='availability-message'], [data-testid='availability-status']",
        "bestbuy": ".fulfillment-add-to-cart-button button, .fulfillment-fulfillment-summary",
        "target": "[data-test='availability-status'], [data-test='shipping-message']",
        "newegg": ".product-inventory, .item-stock-status",
        "generic": ".availability, .stock-status, [class*='availability'], [class*='stock'], [data-availability]"
      },
      "title": {
        "amazon": "#productTitle, .product-title",
        "walmart": "h1[itemprop='name'], [data-testid='product-title']",
        "bestbuy": ".sku-title h1, .product-title",
        "target": "[data-test='product-title'], h1",
        "newegg": ".product-title, #grpDescrip_hero",
        "generic": "h1, .product-title, [data-title], [itemprop='name']"
      }
    }
  },
  "_templates": {
    "competitor": {
      "id": "template_competitor_id",
      "name": "Competitor Name",
      "baseUrl": "https://www.example.com",
      "region": "US",
      "currency": "USD",
      "products": [
        {
          "productId": "SKU_OR_PRODUCT_ID",
          "productName": "Product Name",
          "url": "https://www.example.com/product-page",
          "selectors": {
            "price": {
              "current": ".price-selector",
              "list": ".list-price-selector",
              "sale": ".sale-price-selector",
              "unit": ".unit-price-selector"
            },
            "availability": ".availability-selector",
            "title": ".product-title-selector",
            "rating": ".rating-selector"
          },
          "pricePatterns": {
            "cleanup": "[^0-9.]",
            "decimal": ".",
            "thousand": ","
          }
        }
      ],
      "headers": {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      "rateLimit": {
        "requestsPerMinute": 10,
        "delayBetweenRequests": 6000
      },
      "antiDetection": {
        "useProxy": false,
        "rotateUserAgents": false,
        "randomDelays": false,
        "cookiesRequired": false
      }
    },
    "product": {
      "productId": "UNIQUE_PRODUCT_ID",
      "productName": "Descriptive Product Name",
      "url": "Full product page URL",
      "category": "Electronics",
      "brand": "Brand Name",
      "ourPrice": 299.99,
      "selectors": {
        "price": {
          "current": "CSS selector for current price",
          "list": "CSS selector for list/original price",
          "sale": "CSS selector for sale price if different"
        },
        "availability": "CSS selector for stock status",
        "title": "CSS selector for product title",
        "image": "CSS selector for product image",
        "rating": "CSS selector for rating/reviews"
      }
    }
  },
  "notes": {
    "selectorStrategy": [
      "Always use multiple fallback selectors for price elements (comma-separated)",
      "Test selectors with browser dev tools before adding to config",
      "Include both sale and regular price selectors to catch promotions",
      "Use attribute selectors when class names are dynamic/minified",
      "Consider using :contains() for text-based selection when available"
    ],
    "rateLimiting": [
      "Respect robots.txt of target sites",
      "Implement exponential backoff on 429/503 responses",
      "Use reasonable delays between requests (minimum 2-3 seconds)",
      "Consider rotating proxies for high-volume monitoring",
      "Monitor for CAPTCHA challenges and handle appropriately"
    ],
    "dataValidation": [
      "Verify extracted price is within reasonable range",
      "Check for currency symbol consistency",
      "Validate numeric conversion succeeded",
      "Log raw HTML when parsing fails for debugging"
    ]
  }
}
```