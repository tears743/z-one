#!/usr/bin/env node
/**
 * Price Extraction Engine
 * =======================
 * 
 * Advanced browser automation scraper that extracts prices from configured competitors.
 * Features anti-detection measures, retry logic, and comprehensive error handling.
 * 
 * Usage:
 *   const { extractPrices, scrapeProduct } = require('./scraper');
 *   const results = await extractPrices(['https://amazon.com/dp/...'], 'amazon');
 */

const fs = require('fs').promises;
const path = require('path');
const { chromium } = require('playwright');

// ============================================================================
// Configuration Loading
// ============================================================================

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'competitors.json');

/**
 * Load and parse the competitors configuration
 * @returns {Promise<Object>} Parsed configuration object
 */
async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_PATH, 'utf8');
    const config = JSON.parse(data);
    return config;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Configuration file not found: ${CONFIG_PATH}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in configuration file: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get configuration for a specific competitor
 * @param {string} competitorKey - The competitor identifier
 * @param {Object} config - Full configuration object
 * @returns {Object} Competitor configuration
 */
function getCompetitorConfig(competitorKey, config) {
  const competitors = config.competitors || {};
  if (!competitors[competitorKey]) {
    throw new Error(
      `Competitor '${competitorKey}' not found. ` +
      `Available: ${Object.keys(competitors).join(', ')}`
    );
  }
  return competitors[competitorKey];
}

// ============================================================================
// Anti-Detection & Browser Management
// ============================================================================

/**
 * User-Agent rotation list for stealth
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
];

/**
 * Get random user agent
 * @returns {string} Random user agent string
 */
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Generate random delay within range
 * @param {number} min - Minimum delay in ms
 * @param {number} max - Maximum delay in ms
 * @returns {number} Random delay
 */
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Sleep for specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create browser context with anti-detection settings
 * @param {Object} competitorConfig - Competitor configuration
 * @returns {Promise<Object>} Browser context instance
 */
async function createStealthContext(browser, competitorConfig) {
  const antiDetection = competitorConfig.anti_detection || {};
  const requestConfig = competitorConfig.request_config || {};
  
  // Get viewport dimensions with randomization
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 1280, height: 720 },
  ];
  
  let viewport = viewports[Math.floor(Math.random() * viewports.length)];
  
  // Add slight randomization to viewport if enabled
  if (antiDetection.randomize_viewport) {
    viewport = {
      width: viewport.width + randomDelay(-50, 50),
      height: viewport.height + randomDelay(-50, 50),
    };
  }
  
  const userAgent = antiDetection.rotate_user_agents 
    ? getRandomUserAgent() 
    : (requestConfig.headers?.['User-Agent'] || USER_AGENTS[0]);
  
  const context = await browser.newContext({
    userAgent,
    viewport,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    geolocation: { longitude: -74.006, latitude: 40.7128 },
    permissions: ['geolocation'],
    
    // Additional stealth settings
    bypassCSP: true,
    ignoreHTTPSErrors: true,
    
    // Device emulation for consistency
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  });
  
  // Add init script to mask automation
  await context.addInitScript(() => {
    // Override navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    
    // Override plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    
    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
    
    // Hide Playwright-specific properties
    delete window.__playwright;
    delete window.__pw_manual;
    delete window.__PW_inspect;
  });
  
  // Set extra headers
  const headers = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    ...requestConfig.headers,
  };
  
  if (antiDetection.rotate_user_agents) {
    headers['User-Agent'] = userAgent;
  }
  
  await context.setExtraHTTPHeaders(headers);
  
  return context;
}

// ============================================================================
// Extraction Logic
// ============================================================================

/**
 * Extract text from element using selector configuration
 * @param {Page} page - Playwright page
 * @param {Object} selectorConfig - Selector configuration object
 * @returns {Promise<string|null>} Extracted text or null
 */
async function extractWithSelector(page, selectorConfig) {
  const selectors = [
    selectorConfig.primary,
    ...(selectorConfig.fallbacks || [])
  ].filter(Boolean);
  
  const attribute = selectorConfig.attribute || 'textContent';
  
  for (const selector of selectors) {
    try {
      const element = await page.$(selector);
      if (!element) continue;
      
      let value;
      if (attribute === 'textContent' || attribute === 'innerText') {
        value = await element.textContent();
      } else {
        value = await element.getAttribute(attribute);
      }
      
      if (value) {
        value = value.trim();
        
        // Strip whitespace if configured
        if (selectorConfig.strip_whitespace) {
          value = value.replace(/\s+/g, ' ');
        }
        
        // Truncate if max_length specified
        if (selectorConfig.max_length && value.length > selectorConfig.max_length) {
          value = value.substring(0, selectorConfig.max_length) + '...';
        }
        
        await element.dispose();
        return value;
      }
      
      await element.dispose();
    } catch (error) {
      // Continue to next fallback
      continue;
    }
  }
  
  return null;
}

/**
 * Extract price with currency detection
 * @param {Page} page - Playwright page
 * @param {Object} priceConfig - Price selector configuration
 * @param {Object} currencyConfig - Currency configuration
 * @returns {Promise<{price: number|null, currency: string, raw: string|null}>}
 */
async function extractPrice(page, priceConfig, currencyConfig) {
  const rawPrice = await extractWithSelector(page, priceConfig);
  
  if (!rawPrice) {
    return { price: null, currency: currencyConfig.code || 'USD', raw: null };
  }
  
  // Extract numeric value using regex
  const regexPattern = priceConfig.regex_pattern || '([0-9,.]+)';
  const regex = new RegExp(regexPattern);
  const match = rawPrice.match(regex);
  
  if (match && match[1]) {
    let priceStr = match[1];
    
    // Handle different number formats
    const thousandsSep = currencyConfig.thousands_separator || ',';
    const decimalSep = currencyConfig.decimal_separator || '.';
    
    // Remove thousands separator
    priceStr = priceStr.replace(new RegExp(`\\${thousandsSep}`, 'g'), '');
    
    // Convert decimal separator
    if (decimalSep !== '.') {
      priceStr = priceStr.replace(decimalSep, '.');
    }
    
    const price = parseFloat(priceStr);
    
    if (!isNaN(price)) {
      return {
        price,
        currency: currencyConfig.code || 'USD',
        raw: rawPrice,
      };
    }
  }
  
  // Fallback: try to extract any number
  const fallbackMatch = rawPrice.match(/[0-9,.]+/);
  if (fallbackMatch) {
    const price = parseFloat(fallbackMatch[0].replace(/,/g, ''));
    if (!isNaN(price)) {
      return {
        price,
        currency: currencyConfig.code || 'USD',
        raw: rawPrice,
      };
    }
  }
  
  return { price: null, currency: currencyConfig.code || 'USD', raw: rawPrice };
}

/**
 * Extract availability status
 * @param {Page} page - Playwright page
 * @param {Object} availabilityConfig - Availability selector configuration
 * @returns {Promise<string|null>}
 */
async function extractAvailability(page, availabilityConfig) {
  if (!availabilityConfig || !availabilityConfig.selector) {
    return null;
  }
  
  try {
    const element = await page.$(availabilityConfig.selector);
    if (!element) return null;
    
    const text = (await element.textContent() || '').toLowerCase();
    await element.dispose();
    
    const inStockKeywords = availabilityConfig.in_stock_keywords || ['in stock', 'available'];
    const outOfStockKeywords = availabilityConfig.out_of_stock_keywords || ['out of stock', 'unavailable'];
    
    for (const keyword of inStockKeywords) {
      if (text.includes(keyword.toLowerCase())) return 'in_stock';
    }
    
    for (const keyword of outOfStockKeywords) {
      if (text.includes(keyword.toLowerCase())) return 'out_of_stock';
    }
    
    return text;
  } catch (error) {
    return null;
  }
}

/**
 * Simulate human-like behavior on the page
 * @param {Page} page - Playwright page
 * @param {Object} antiDetectionConfig - Anti-detection configuration
 */
async function simulateHumanBehavior(page, antiDetectionConfig) {
  if (!antiDetectionConfig?.simulate_human_behavior) return;
  
  // Random scroll
  const scrolls = randomDelay(2, 5);
  for (let i = 0; i < scrolls; i++) {
    await page.evaluate(() => {
      window.scrollBy(0, Math.random() * 300 + 100);
    });
    await sleep(randomDelay(200, 800));
  }
  
  // Random mouse movements
  if (Math.random() < (antiDetectionConfig.mouse_movement_probability || 0.5)) {
    const viewport = page.viewportSize();
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(
        randomDelay(100, viewport.width - 100),
        randomDelay(100, viewport.height - 100)
      );
      await sleep(randomDelay(100, 300));
    }
  }
  
  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(randomDelay(100, 300));
}

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Calculate delay with exponential backoff
 * @param {number} attempt - Current attempt number (0-indexed)
 * @param {number} baseDelay - Base delay in seconds
 * @param {number} multiplier - Backoff multiplier
 * @returns {number} Delay in milliseconds
 */
function calculateBackoff(attempt, baseDelay, multiplier) {
  const delay = baseDelay * Math.pow(multiplier, attempt);
  const jitter = Math.random() * 1000; // Add up to 1s jitter
  return (delay * 1000) + jitter;
}

/**
 * Check if error is retryable
 * @param {Error} error - The error object
 * @param {Object} retryConfig - Retry configuration
 * @returns {boolean}
 */
function isRetryableError(error, retryConfig) {
  const retryExceptions = retryConfig.retry_on_exceptions || ['TimeoutError'];
  const retryStatusCodes = retryConfig.retry_on_status_codes || [429, 500, 502, 503, 504];
  
  // Check by error name/type
  for (const exceptionType of retryExceptions) {
    if (error.name === exceptionType || error.message.includes(exceptionType)) {
      return true;
    }
  }
  
  // Check by status code for HTTP errors
  if (error.status && retryStatusCodes.includes(error.status)) {
    return true;
  }
  
  // Common retryable patterns
  const retryablePatterns = [
    'timeout',
    'Navigation timeout',
    'net::ERR_',
    'NS_ERROR_',
    'Navigation failed',
  ];
  
  for (const pattern of retryablePatterns) {
    if (error.message.includes(pattern)) {
      return true;
    }
  }
  
  return false;
}

// ============================================================================
// Main Scraping Functions
// ============================================================================

/**
 * Scrape a single product URL
 * @param {string} url - Product URL to scrape
 * @param {string} competitorKey - Competitor identifier
 * @param {Object} browser - Playwright browser instance
 * @param {Object} config - Full configuration
 * @returns {Promise<Object>} Scraping result
 */
async function scrapeProduct(url, competitorKey, browser, config) {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  let result = {
    competitor: competitorKey,
    product: null,
    price: null,
    currency: null,
    url,
    timestamp,
    success: false,
    error: null,
    duration: 0,
  };
  
  let context = null;
  let page = null;
  
  try {
    const competitorConfig = getCompetitorConfig(competitorKey, config);
    
    if (!competitorConfig.enabled) {
      throw new Error(`Competitor '${competitorKey}' is disabled in configuration`);
    }
    
    // Create stealth context
    context = await createStealthContext(browser, competitorConfig);
    
    // Create new page
    page = await context.newPage();
    
    // Get retry configuration
    const retryConfig = competitorConfig.retry_config || {};
    const maxRetries = retryConfig.max_retries ?? 3;
    const baseDelay = retryConfig.retry_delay_seconds ?? 2;
    const multiplier = retryConfig.backoff_multiplier ?? 2;
    
    let lastError = null;
    
    // Retry loop
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const backoff = calculateBackoff(attempt - 1, baseDelay, multiplier);
          console.log(`  Retry ${attempt}/${maxRetries} for ${url} - waiting ${Math.round(backoff)}ms`);
          await sleep(backoff);
        }
        
        // Navigate to URL
        const timeout = (competitorConfig.request_config?.timeout_seconds || 30) * 1000;
        
        const response = await page.goto(url, {
          waitUntil: 'networkidle',
          timeout,
        });
        
        if (!response) {
          throw new Error('Navigation failed - no response');
        }
        
        // Check for blocking/verification pages
        const title = await page.title();
        const content = await page.content();
        
        const blockingIndicators = [
          'robot',
          'captcha',
          'verify',
          'access denied',
          'blocked',
          'security check',
        ];
        
        const isBlocked = blockingIndicators.some(indicator => 
          title.toLowerCase().includes(indicator) ||
          content.toLowerCase().includes(indicator)
        );
        
        if (isBlocked) {
          throw new Error('Access blocked by anti-bot measures');
        }
        
        // Wait for page to settle
        await sleep(randomDelay(1000, 3000));
        
        // Simulate human behavior
        await simulateHumanBehavior(page, competitorConfig.anti_detection);
        
        // Extract data
        const selectors = competitorConfig.selectors?.product_page;
        if (!selectors) {
          throw new Error('No product_page selectors configured');
        }
        
        // Extract product name
        const productName = selectors.product_name 
          ? await extractWithSelector(page, selectors.product_name)
          : null;
        
        // Extract price
        const { price, currency, raw } = selectors.price
          ? await extractPrice(page, selectors.price, competitorConfig.currency || {})
          : { price: null, currency: null, raw: null };
        
        // Extract availability
        const availability = selectors.availability
          ? await extractAvailability(page, selectors.availability)
          : null;
        
        // Build result
        result = {
          ...result,
          product: productName,
          price,
          currency,
          availability,
          raw_price_text: raw,
          success: price !== null,
          http_status: response.status(),
          duration: Date.now() - startTime,
        };
        
        // Success - break retry loop
        break;
        
      } catch (error) {
        lastError = error;
        
        // Check if we should retry
        if (attempt < maxRetries && isRetryableError(error, retryConfig)) {
          console.log(`  Attempt ${attempt + 1} failed: ${error.message}`);
          continue;
        }
        
        // Not retryable or exhausted retries
        throw error;
      }
    }
    
  } catch (error) {
    result.error = error.message;
    result.success = false;
    result.duration = Date.now() - startTime;
    
    // Classify error type
    if (error.message.includes('timeout')) {
      result.error_type = 'TIMEOUT';
    } else if (error.message.includes('blocked') || error.message.includes('captcha')) {
      result.error_type = 'BLOCKED';
    } else if (error.message.includes('selector')) {
      result.error_type = 'SELECTOR_NOT_FOUND';
    } else {
      result.error_type = 'UNKNOWN';
    }
  } finally {
    // Cleanup
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
  
  return result;
}

/**
 * Extract prices from multiple URLs
 * @param {string[]} urls - Array of product URLs to scrape
 * @param {string} competitorKey - Competitor identifier (optional, auto-detected if not provided)
 * @param {Object} options - Additional options
 * @returns {Promise<Array>} Array of scraping results
 */
async function extractPrices(urls, competitorKey = null, options = {}) {
  const {
    concurrent = 1,              // Number of concurrent scrapes
    delayBetweenRequests = 2000, // Delay between requests in ms
    headless = true,             // Run browser in headless mode
    onProgress = null,           // Progress callback (completed, total)
  } = options;
  
  if (!urls || urls.length === 0) {
    throw new Error('No URLs provided');
  }
  
  // Load configuration
  const config = await loadConfig();
  
  // Auto-detect competitor if not specified
  if (!competitorKey) {
    // Try to match URL to competitor
    for (const [key, compConfig] of Object.entries(config.competitors || {})) {
      if (urls[0].includes(compConfig.base_url)) {
        competitorKey = key;
        console.log(`Auto-detected competitor: ${competitorKey}`);
        break;
      }
    }
    
    if (!competitorKey) {
      throw new Error('Could not auto-detect competitor. Please specify competitorKey.');
    }
  }
  
  const competitorConfig = getCompetitorConfig(competitorKey, config);
  
  console.log(`\n🚀 Starting price extraction for ${competitorConfig.name}`);
  console.log(`   URLs to scrape: ${urls.length}`);
  console.log(`   Concurrent: ${concurrent}`);
  console.log('');
  
  // Launch browser
  const browser = await chromium.launch({ 
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
  });
  
  const results = [];
  let completed = 0;
  
  try {
    // Process URLs with concurrency control
    for (let i = 0; i < urls.length; i += concurrent) {
      const batch = urls.slice(i, i + concurrent);
      
      // Scrape batch concurrently
      const batchPromises = batch.map(url => 
        scrapeProduct(url, competitorKey, browser, config)
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      completed += batch.length;
      
      // Report progress
      if (onProgress) {
        onProgress(completed, urls.length);
      }
      
      // Log batch results
      batchResults.forEach((result, idx) => {
        const num = i + idx + 1;
        if (result.success) {
          console.log(`  ✅ [${num}/${urls.length}] ${result.product?.substring(0, 50) || 'Unknown'}`);
          console.log(`     Price: ${result.currency} ${result.price} | Time: ${result.duration}ms`);
        } else {
          console.log(`  ❌ [${num}/${urls.length}] Failed: ${result.error}`);
        }
      });
      
      // Delay between batches (except after last batch)
      if (i + concurrent < urls.length) {
        const rateLimit = competitorConfig.rate_limiting || {};
        const delay = rateLimit.delay_between_requests_ms || delayBetweenRequests;
        const jitter = randomDelay(0, rateLimit.jitter_ms || 500);
        await sleep(delay + jitter);
      }
    }
    
  } finally {
    await browser.close();
  }
  
  // Summary
  const successful = results.filter(r => r.success).length;
  console.log(`\n📊 Extraction complete: ${successful}/${results.length} successful`);
  
  return results;
}

/**
 * Scrape multiple competitors
 * @param {Array<{url: string, competitor: string}>} targets - Array of target objects
 * @param {Object} options - Scraping options
 * @returns {Promise<Array>} Combined results
 */
async function scrapeMultiple(targets, options = {}) {
  const results = [];
  
  // Group by competitor for efficiency
  const byCompetitor = targets.reduce((acc, target) => {
    if (!acc[target.competitor]) acc[target.competitor] = [];
    acc[target.competitor].push(target.url);
    return acc;
  }, {});
  
  for (const [competitor, urls] of Object.entries(byCompetitor)) {
    const competitorResults = await extractPrices(urls, competitor, options);
    results.push(...competitorResults);
  }
  
  return results;
}

// ============================================================================
// CLI Interface
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Price Extraction Engine
=======================

Usage:
  node scraper.js --url <url> --competitor <key>
  node scraper.js --urls <url1,url2,...> --competitor <key>
  node scraper.js --config

Options:
  --url <url>           Single URL to scrape
  --urls <urls>         Comma-separated list of URLs
  --competitor <key>    Competitor key from config
  --concurrent <n>      Number of concurrent requests (default: 1)
  --headful             Show browser window (for debugging)
  --config              Show available competitors
  --help                Show this help message

Examples:
  node scraper.js --url "https://amazon.com/dp/B08N5WRWNW" --competitor amazon
  node scraper.js --urls "url1,url2,url3" --competitor amazon --concurrent 2
`);
    return;
  }
  
  // Show configuration
  if (args.includes('--config')) {
    const config = await loadConfig();
    console.log('\n📋 Configured Competitors:\n');
    
    for (const [key, comp] of Object.entries(config.competitors || {})) {
      const status = comp.enabled ? '✅' : '❌';
      console.log(`${status} ${key}: ${comp.name}`);
      console.log(`   Base URL: ${comp.base_url}`);
      console.log(`   Enabled: ${comp.enabled}`);
      console.log('');
    }
    return;
  }
  
  // Parse arguments
  const urlIndex = args.indexOf('--url');
  const urlsIndex = args.indexOf('--urls');
  const competitorIndex = args.indexOf('--competitor');
  const concurrentIndex = args.indexOf('--concurrent');
  const headful = args.includes('--headful');
  
  let urls = [];
  let competitor = null;
  
  if (urlIndex !== -1) {
    urls = [args[urlIndex + 1]];
  } else if (urlsIndex !== -1) {
    urls = args[urlsIndex + 1].split(',').map(u => u.trim());
  }
  
  if (competitorIndex !== -1) {
    competitor = args[competitorIndex + 1];
  }
  
  const concurrent = concurrentIndex !== -1 ? parseInt(args[concurrentIndex + 1]) : 1;
  
  if (urls.length === 0) {
    console.error('❌ Error: No URLs provided. Use --url or --urls');
    process.exit(1);
  }
  
  try {
    const results = await extractPrices(urls, competitor, {
      concurrent,
      headless: !headful,
      onProgress: (completed, total) => {
        process.stdout.write(`\r  Progress: ${completed}/${total}`);
      },
    });
    
    console.log('\n\n📦 Results:');
    console.log(JSON.stringify(results, null, 2));
    
    // Exit with error code if any failed
    const failed = results.filter(r => !r.success).length;
    if (failed > 0) {
      process.exit(1);
    }
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  extractPrices,
  scrapeProduct,
  scrapeMultiple,
  loadConfig,
  getCompetitorConfig,
};

// Run CLI if called directly
if (require.main === module) {
  main().catch(error => {
    console.error(`\n❌ Fatal error: ${error.message}`);
    process.exit(1);
  });
}
