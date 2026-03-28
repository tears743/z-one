#!/usr/bin/env node
/**
 * Monitor Module Test Suite
 * =========================
 *
 * Unit tests for the main workflow orchestrator
 */

const path = require('path');
const fs = require('fs');

// Test configuration
const TEST_CONFIG = {
  verbose: process.argv.includes('--verbose') || process.argv.includes('-v')
};

// Simple test framework
const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Assertion failed'}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(message || 'Expected true but got false');
  }
}

function assertFalse(value, message) {
  if (value) {
    throw new Error(message || 'Expected false but got true');
  }
}

// ============================================================================
// Tests
// ============================================================================

test('Module loads without errors', () => {
  const monitor = require('./monitor.js');
  assertTrue(monitor.runMonitoring, 'runMonitoring should be exported');
  assertTrue(monitor.transformScraperToAnalyzer, 'transformScraperToAnalyzer should be exported');
  assertTrue(monitor.writeAlertFile, 'writeAlertFile should be exported');
  assertTrue(monitor.writeLastRunLog, 'writeLastRunLog should be exported');
  assertTrue(monitor.CONFIG, 'CONFIG should be exported');
});

test('Transform scraper to analyzer format', () => {
  const { transformScraperToAnalyzer } = require('./monitor.js');
  
  const scraperResults = [
    {
      competitor: 'amazon',
      product: 'Test Product',
      price: 99.99,
      currency: 'USD',
      availability: 'in_stock',
      url: 'https://amazon.com/dp/B123',
      timestamp: '2026-03-21T10:00:00.000Z',
      success: true,
      error: null
    },
    {
      competitor: 'shopify',
      product: 'Another Product',
      price: 49.99,
      currency: 'EUR',
      url: 'https://shop.example.com/products/item',
      timestamp: '2026-03-21T10:00:00.000Z',
      success: true
    },
    {
      competitor: 'failed',
      product: null,
      price: null,
      success: false,
      error: 'Timeout'
    }
  ];
  
  const result = transformScraperToAnalyzer(scraperResults);
  
  assertEqual(result.length, 2, 'Should filter out failed results');
  assertEqual(result[0].product_id, 'Test Product', 'First product ID should match');
  assertEqual(result[0].competitor_name, 'amazon', 'First competitor should match');
  assertEqual(result[0].price, 99.99, 'First price should match');
  assertEqual(result[0].currency, 'USD', 'First currency should match');
  assertEqual(result[1].currency, 'EUR', 'Second currency should match');
});

test('Transform handles edge cases', () => {
  const { transformScraperToAnalyzer } = require('./monitor.js');
  
  // Empty array
  assertEqual(transformScraperToAnalyzer([]).length, 0, 'Empty input returns empty');
  
  // All failures
  const allFailed = [
    { success: false, price: null },
    { success: false, error: 'Network error' }
  ];
  assertEqual(transformScraperToAnalyzer(allFailed).length, 0, 'All failed returns empty');
  
  // Missing fields
  const missingFields = [
    {
      competitor: 'test',
      price: 10.00,
      success: true
      // missing product, currency, url
    }
  ];
  const result = transformScraperToAnalyzer(missingFields);
  assertEqual(result.length, 1, 'Should handle missing fields');
  assertEqual(result[0].product_id, 'unknown-product', 'Default product_id');
  assertEqual(result[0].currency, 'USD', 'Default currency');
});

test('Timestamp formatting', () => {
  const { formatTimestamp, formatTimestampForFilename } = require('./monitor.js');
  
  const isoTimestamp = formatTimestamp();
  assertTrue(isoTimestamp.includes('T'), 'ISO timestamp should contain T');
  assertTrue(isoTimestamp.includes('Z') || isoTimestamp.includes('+'), 'ISO timestamp should have timezone');
  
  const filenameTimestamp = formatTimestampForFilename();
  assertTrue(filenameTimestamp.includes('_'), 'Filename timestamp should contain underscore');
  assertTrue(filenameTimestamp.includes('-'), 'Filename timestamp should contain hyphens');
  assertFalse(filenameTimestamp.includes(':'), 'Filename timestamp should not contain colons');
});

test('CONFIG has required paths', () => {
  const { CONFIG } = require('./monitor.js');
  
  assertTrue(CONFIG.LOGS_DIR, 'LOGS_DIR should be defined');
  assertTrue(CONFIG.ALERTS_DIR, 'ALERTS_DIR should be defined');
  assertTrue(CONFIG.RUNS_DIR, 'RUNS_DIR should be defined');
  assertTrue(CONFIG.LAST_RUN_LOG, 'LAST_RUN_LOG should be defined');
  assertTrue(CONFIG.ALERT_FILE_FORMAT, 'ALERT_FILE_FORMAT should be defined');
  assertEqual(CONFIG.EXIT_CODE_SUCCESS, 0, 'Success exit code should be 0');
  assertEqual(CONFIG.EXIT_CODE_FAILURE, 1, 'Failure exit code should be 1');
});

test('Directory paths resolve correctly', () => {
  const { CONFIG } = require('./monitor.js');
  
  assertTrue(CONFIG.LOGS_DIR.includes('logs'), 'LOGS_DIR should contain logs');
  assertTrue(CONFIG.ALERTS_DIR.includes('alerts'), 'ALERTS_DIR should contain alerts');
  assertTrue(CONFIG.RUNS_DIR.includes('runs'), 'RUNS_DIR should contain runs');
  assertTrue(path.isAbsolute(CONFIG.LOGS_DIR) || CONFIG.LOGS_DIR.startsWith('.'), 
    'LOGS_DIR should be a valid path');
});

// ============================================================================
// Run Tests
// ============================================================================

async function runTests() {
  console.log('='.repeat(60));
  console.log('Monitor Module Test Suite');
  console.log('='.repeat(60));
  console.log();
  
  for (const { name, fn } of tests) {
    try {
      if (TEST_CONFIG.verbose) {
        console.log(`Running: ${name}...`);
      }
      
      const result = fn();
      
      // Handle async tests
      if (result && typeof result.then === 'function') {
        await result;
      }
      
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (error) {
      console.log(`❌ FAIL: ${name}`);
      console.log(`   Error: ${error.message}`);
      if (TEST_CONFIG.verbose && error.stack) {
        console.log(`   Stack: ${error.stack.split('\n')[1]?.trim()}`);
      }
      failed++;
    }
  }
  
  console.log();
  console.log('='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  console.log(`Total:  ${tests.length}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
  console.log();
  
  if (failed > 0) {
    console.log('Some tests failed! ❌');
    process.exit(1);
  } else {
    console.log('All tests passed! ✅');
    process.exit(0);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
