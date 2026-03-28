# Price Extraction Engine

A robust browser automation scraper that extracts prices from competitor websites using the configuration system defined in `config/competitors.json`.

## Features

- 🎭 **Stealth Mode**: Anti-detection measures including User-Agent rotation, viewport randomization, and automation masking
- 🔄 **Retry Logic**: Exponential backoff with configurable retry attempts
- 🎯 **Smart Selectors**: Primary selector with multiple fallbacks for resilient extraction
- ⏱️ **Rate Limiting**: Respects configured rate limits with jitter
- 📊 **Structured Output**: Consistent result format with success/error tracking
- 🌐 **Multi-Competitor**: Support for multiple competitor configurations

## Installation

```bash
npm install playwright
npx playwright install chromium
```

## Quick Start

### Command Line Usage

```bash
# Show available competitors
node scripts/scraper.js --config

# Scrape a single URL
node scripts/scraper.js --url "https://amazon.com/dp/B08N5WRWNW" --competitor amazon

# Scrape multiple URLs
node scripts/scraper.js --urls "url1,url2,url3" --competitor amazon

# Scrape with concurrency (faster but riskier)
node scripts/scraper.js --urls "url1,url2,url3" --competitor amazon --concurrent 2

# Debug mode (visible browser)
node scripts/scraper.js --url "https://example.com/product" --competitor shopify_generic --headful
```

### Programmatic Usage

```javascript
const { extractPrices, scrapeMultiple } = require('./scripts/scraper');

// Scrape single competitor
const results = await extractPrices(
  ['https://amazon.com/dp/B08N5WRWNW'],
  'amazon',
  {
    concurrent: 1,
    delayBetweenRequests: 2000,
    headless: true,
    onProgress: (completed, total) => {
      console.log(`Progress: ${completed}/${total}`);
    }
  }
);

console.log(results);
// [
//   {
//     competitor: 'amazon',
//     product: 'Product Name',
//     price: 299.99,
//     currency: 'USD',
//     availability: 'in_stock',
//     url: 'https://amazon.com/dp/B08N5WRWNW',
//     timestamp: '2026-03-21T10:30:00.000Z',
//     success: true,
//     duration: 4523
//   }
// ]

// Scrape multiple competitors
const targets = [
  { url: 'https://amazon.com/dp/B08N5WRWNW', competitor: 'amazon' },
  { url: 'https://shop.example.com/products/item', competitor: 'shopify_generic' },
];

const allResults = await scrapeMultiple(targets, { concurrent: 2 });
```

## Configuration

The scraper reads from `config/competitors.json`. See the config README for details on adding new competitors.

### Key Configuration Sections

- **selectors**: CSS selectors for price, product name, availability
- **currency**: Currency code, symbol, and formatting rules
- **request_config**: HTTP headers and timeout settings
- **retry_config**: Retry attempts, delays, and backoff strategy
- **rate_limiting**: Requests per minute and delay settings
- **anti_detection**: Stealth mode settings

## Result Format

```typescript
interface ScrapingResult {
  competitor: string;        // Competitor key
  product: string | null;    // Product name
  price: number | null;      // Extracted price
  currency: string | null;   // Currency code (USD, EUR, etc.)
  availability: string | null; // in_stock, out_of_stock, or raw text
  url: string;               // Source URL
  timestamp: string;         // ISO 8601 timestamp
  success: boolean;          // Extraction success status
  error: string | null;      // Error message if failed
  error_type: string | null; // TIMEOUT, BLOCKED, SELECTOR_NOT_FOUND, UNKNOWN
  duration: number;          // Extraction time in ms
  http_status: number;       // HTTP response status
  raw_price_text: string;    // Raw price text before parsing
}
```

## Error Handling

### Retryable Errors

The scraper automatically retries on:
- Navigation timeouts
- Connection errors
- HTTP 429 (Too Many Requests)
- HTTP 5xx (Server errors)
- Network failures

### Non-Retryable Errors

These fail immediately:
- HTTP 403 (Forbidden) - Likely blocked
- HTTP 404 (Not Found)
- Selector not found (after all fallbacks)
- Access blocked by anti-bot measures

### Error Types

| Type | Description | Action |
|------|-------------|--------|
| `TIMEOUT` | Page load or selector timeout | Increase timeout in config |
| `BLOCKED` | Anti-bot detection triggered | Enable more stealth options |
| `SELECTOR_NOT_FOUND` | All selectors failed | Update selectors in config |
| `UNKNOWN` | Unexpected error | Check logs and retry |

## Anti-Detection Measures

### Stealth Features

1. **User-Agent Rotation**: Randomized from realistic browser UAs
2. **Viewport Randomization**: Varies window dimensions slightly
3. **WebDriver Masking**: Removes `navigator.webdriver` property
4. **Plugin Spoofing**: Simulates browser plugins
5. **Language Spoofing**: Sets realistic language headers
6. **Mouse Movements**: Random cursor movements (optional)
7. **Scroll Behavior**: Human-like scrolling patterns

### Configuration

Enable in `config/competitors.json`:

```json
"anti_detection": {
  "use_proxy_rotation": true,
  "rotate_user_agents": true,
  "randomize_viewport": true,
  "simulate_human_behavior": true,
  "mouse_movement_probability": 0.7
}
```

## Best Practices

### Rate Limiting

Start conservative and adjust based on results:

```json
"rate_limiting": {
  "requests_per_minute": 20,        // Start low
  "delay_between_requests_ms": 3000,
  "jitter_ms": 500
}
```

### Selector Strategy

1. Use stable selectors (IDs, data attributes)
2. Avoid CSS-in-JS class names
3. Provide multiple fallbacks
4. Test selectors in browser console first

```json
"price": {
  "primary": "#priceblock_dealprice",
  "fallbacks": [
    "#priceblock_ourprice",
    ".a-price .a-offscreen",
    "[data-price]"
  ]
}
```

### Debugging

Enable headful mode to see what's happening:

```bash
node scripts/scraper.js --url "..." --competitor amazon --headful
```

## Advanced Usage

### Custom Extraction Logic

```javascript
const { loadConfig, getCompetitorConfig } = require('./scripts/scraper');

async function customScrape(url, competitorKey) {
  const config = await loadConfig();
  const competitor = getCompetitorConfig(competitorKey, config);
  
  // Custom logic here
  console.log(`Scraping ${competitor.name} with ${competitor.rate_limiting.requests_per_minute} RPM limit`);
  
  // Use the scraper
  const results = await extractPrices([url], competitorKey);
  return results;
}
```

### Integration with Data Store

```javascript
const { extractPrices } = require('./scripts/scraper');
const DataStore = require('../utils/data-store');

async function trackPrices(products) {
  const dataStore = new DataStore();
  
  for (const product of products) {
    const results = await extractPrices([product.url], product.competitor);
    
    for (const result of results) {
      if (result.success) {
        await dataStore.recordPrice({
          product_id: product.id,
          competitor_name: result.competitor,
          price: result.price,
          currency: result.currency,
          url: result.url,
          status: 'success'
        });
      }
    }
  }
}
```

## Troubleshooting

### Common Issues

**Issue**: Getting blocked after few requests  
**Solution**: Increase delays, enable more anti-detection options, use proxy rotation

**Issue**: Selectors not working  
**Solution**: Check if site uses JavaScript rendering, increase wait time, update selectors

**Issue**: Price extraction returns null  
**Solution**: Check regex pattern matches site format, verify currency symbol

**Issue**: Navigation timeouts  
**Solution**: Increase timeout in config, check if site is slow, check network

### Logs and Debugging

Enable verbose logging:

```javascript
const results = await extractPrices(urls, competitor, {
  onProgress: (completed, total) => {
    console.log(`${completed}/${total} completed`);
  }
});
```

## API Reference

### `extractPrices(urls, competitorKey, options)`

Extract prices from multiple URLs for a single competitor.

**Parameters:**
- `urls` (string[]): Array of product URLs
- `competitorKey` (string): Competitor identifier from config
- `options` (Object): 
  - `concurrent` (number): Concurrent requests (default: 1)
  - `delayBetweenRequests` (number): Delay in ms (default: 2000)
  - `headless` (boolean): Run headless (default: true)
  - `onProgress` (function): Progress callback

**Returns:** Promise<Array<ScrapingResult>>

### `scrapeProduct(url, competitorKey, browser, config)`

Scrape a single product (advanced usage with shared browser).

### `scrapeMultiple(targets, options)`

Scrape products from multiple competitors.

**Parameters:**
- `targets` (Array): `{url, competitor}` objects
- `options` (Object): Same as extractPrices

### `loadConfig()`

Load and parse competitors.json.

### `getCompetitorConfig(key, config)`

Get configuration for specific competitor.

## Security Notes

- Always respect robots.txt
- Don't scrape faster than necessary
- Use appropriate delays between requests
- Be prepared for site structure changes
- Monitor for blocking and adjust accordingly
- Consider legal implications in your jurisdiction

## License

MIT
