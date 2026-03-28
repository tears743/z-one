#!/usr/bin/env node
/**
 * Scraper Module Tests
 * 
 * Run with: node scripts/scraper.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Change to project root
process.chdir(path.join(__dirname, '..'));

const {
  loadConfig,
  getCompetitorConfig,
  extractPrices,
} = require('./scraper');

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${error.message}`);
    testsFailed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

// ============================================================================
// Tests
// ============================================================================

async function runTests() {
  console.log('\n🧪 Running Scraper Tests\n');
  
  // Test 1: Load configuration
  await test('loadConfig() loads valid JSON', async () => {
    const config = await loadConfig();
    assert(config._schema_version, 'Should have schema version');
    assert(config.competitors, 'Should have competitors object');
  });
  
  // Test 2: Get competitor config
  await test('getCompetitorConfig() returns specific competitor', async () => {
    const config = await loadConfig();
    const amazon = getCompetitorConfig('amazon', config);
    assertEqual(amazon.name, 'Amazon', 'Competitor name should match');
    assert(amazon.selectors, 'Should have selectors');
    assert(amazon.selectors.product_page, 'Should have product_page selectors');
    assert(amazon.selectors.product_page.price, 'Should have price selector');
  });
  
  // Test 3: Competitor has required fields
  await test('Competitor config has all required fields', async () => {
    const config = await loadConfig();
    const competitors = config.competitors;
    
    for (const [key, comp] of Object.entries(competitors)) {
      assert(comp.name, `${key} should have name`);
      assert(comp.base_url, `${key} should have base_url`);
      assert(comp.selectors, `${key} should have selectors`);
      assert(comp.currency, `${key} should have currency`);
      
      if (comp.enabled) {
        assert(comp.selectors.product_page, `${key} should have product_page selectors`);
        assert(comp.selectors.product_page.price, `${key} should have price selector`);
        assert(comp.selectors.product_page.product_name, `${key} should have product_name selector`);
      }
    }
  });
  
  // Test 4: Price selector structure
  await test('Price selector has primary and fallbacks', async () => {
    const config = await loadConfig();
    const amazon = getCompetitorConfig('amazon', config);
    const price = amazon.selectors.product_page.price;
    
    assert(price.primary, 'Should have primary selector');
    assert(Array.isArray(price.fallbacks), 'Fallbacks should be array');
    assert(price.regex_pattern, 'Should have regex pattern');
  });
  
  // Test 5: Retry configuration
  await test('Retry configuration is valid', async () => {
    const config = await loadConfig();
    const amazon = getCompetitorConfig('amazon', config);
    const retry = amazon.retry_config;
    
    assert(typeof retry.max_retries === 'number', 'max_retries should be number');
    assert(typeof retry.retry_delay_seconds === 'number', 'retry_delay_seconds should be number');
    assert(typeof retry.backoff_multiplier === 'number', 'backoff_multiplier should be number');
    assert(Array.isArray(retry.retry_on_status_codes), 'retry_on_status_codes should be array');
    assert(Array.isArray(retry.retry_on_exceptions), 'retry_on_exceptions should be array');
    
    assert(retry.max_retries >= 0, 'max_retries should be >= 0');
    assert(retry.retry_delay_seconds >= 0, 'retry_delay_seconds should be >= 0');
    assert(retry.backoff_multiplier >= 1, 'backoff_multiplier should be >= 1');
  });
  
  // Test 6: Rate limiting
  await test('Rate limiting configuration is valid', async () => {
    const config = await loadConfig();
    const amazon = getCompetitorConfig('amazon', config);
    const rateLimit = amazon.rate_limiting;
    
    assert(typeof rateLimit.requests_per_minute === 'number', 'requests_per_minute should be number');
    assert(typeof rateLimit.delay_between_requests_ms === 'number', 'delay_between_requests_ms should be number');
    assert(typeof rateLimit.jitter_ms === 'number', 'jitter_ms should be number');
    
    assert(rateLimit.requests_per_minute >= 1, 'requests_per_minute should be >= 1');
  });
  
  // Test 7: Headers configuration
  await test('Request headers include User-Agent', async () => {
    const config = await loadConfig();
    const amazon = getCompetitorConfig('amazon', config);
    const headers = amazon.request_config?.headers;
    
    assert(headers, 'Should have headers');
    assert(headers['User-Agent'], 'Should have User-Agent');
    assert(headers['Accept'], 'Should have Accept header');
  });
  
  // Test 8: Currency configuration
  await test('Currency configuration is valid', async () => {
    const config = await loadConfig();
    const amazon = getCompetitorConfig('amazon', config);
    const currency = amazon.currency;
    
    assert(currency.code, 'Should have currency code');
    assert(currency.symbol !== undefined, 'Should have currency symbol');
    assert(currency.position, 'Should have currency position');
  });
  
  // Test 9: Error handling for missing competitor
  await test('getCompetitorConfig() throws for missing competitor', async () => {
    const config = await loadConfig();
    let errorThrown = false;
    
    try {
      getCompetitorConfig('nonexistent_competitor', config);
    } catch (error) {
      errorThrown = true;
      assert(error.message.includes('not found'), 'Error should indicate competitor not found');
    }
    
    assert(errorThrown, 'Should throw error for missing competitor');
  });
  
  // Test 10: Anti-detection configuration
  await test('Anti-detection settings are present', async () => {
    const config = await loadConfig();
    const amazon = getCompetitorConfig('amazon', config);
    
    assert(amazon.anti_detection, 'Should have anti_detection config');
    assert(typeof amazon.anti_detection.rotate_user_agents === 'boolean', 'Should specify rotate_user_agents');
    assert(typeof amazon.anti_detection.simulate_human_behavior === 'boolean', 'Should specify simulate_human_behavior');
  });
  
  // Test 11: Availability selector
  await test('Availability selector is configured', async () => {
    const config = await loadConfig();
    const amazon = getCompetitorConfig('amazon', config);
    const availability = amazon.selectors.product_page.availability;
    
    assert(availability, 'Should have availability selector');
    assert(availability.selector, 'Should have selector');
    assert(Array.isArray(availability.in_stock_keywords), 'Should have in_stock_keywords array');
    assert(Array.isArray(availability.out_of_stock_keywords), 'Should have out_of_stock_keywords array');
  });
  
  // Test 12: Global settings
  await test('Global settings are present', async () => {
    const config = await loadConfig();
    
    assert(config.global_settings, 'Should have global_settings');
    assert(typeof config.global_settings.default_request_timeout === 'number', 'Should have default_request_timeout');
    assert(typeof config.global_settings.default_max_retries === 'number', 'Should have default_max_retries');
  });
  
  // Test 13: Extract prices with empty URLs
  await test('extractPrices() throws for empty URLs', async () => {
    let errorThrown = false;
    
    try {
      await extractPrices([], 'amazon');
    } catch (error) {
      errorThrown = true;
      assert(error.message.includes('No URLs'), 'Error should indicate no URLs');
    }
    
    assert(errorThrown, 'Should throw error for empty URLs');
  });
  
  // Test 14: Extract prices with invalid competitor
  await test('extractPrices() throws for invalid competitor', async () => {
    let errorThrown = false;
    
    try {
      await extractPrices(['http://example.com'], 'invalid_competitor');
    } catch (error) {
      errorThrown = true;
      assert(error.message.includes('not found'), 'Error should indicate competitor not found');
    }
    
    assert(errorThrown, 'Should throw error for invalid competitor');
  });
  
  // Test 15: Config file exists
  await test('Configuration file exists', () => {
    const configPath = path.join(__dirname, '..', 'config', 'competitors.json');
    assert(fs.existsSync(configPath), 'competitors.json should exist');
    
    const stats = fs.statSync(configPath);
    assert(stats.size > 0, 'Configuration file should not be empty');
  });
  
  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log(`Tests: ${testsPassed + testsFailed}`);
  console.log(`Passed: ${testsPassed} ✅`);
  console.log(`Failed: ${testsFailed} ❌`);
  console.log('='.repeat(50) + '\n');
  
  if (testsFailed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('\n💥 Test runner error:', error);
  process.exit(1);
});
