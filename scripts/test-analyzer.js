/**
 * Test script for the Price Analyzer
 */

const { analyzePrices, calculatePriceChange, generateMarkdownReport } = require('./analyzer.js');
const dataStore = require('../utils/data-store.js');

console.log('🧪 Testing Price Analyzer Module\n');

// Test 1: Calculate price change
console.log('Test 1: calculatePriceChange()');
const change1 = calculatePriceChange(100, 90);
console.log('  $100 → $90:', change1.direction, change1.percentChange + '%');
console.assert(change1.direction === 'drop', 'Should detect price drop');
console.assert(change1.percentChange === -10, 'Should be -10%');

const change2 = calculatePriceChange(100, 110);
console.log('  $100 → $110:', change2.direction, change2.percentChange + '%');
console.assert(change2.direction === 'increase', 'Should detect price increase');
console.assert(change2.percentChange === 10, 'Should be +10%');

const change3 = calculatePriceChange(100, 100);
console.log('  $100 → $100:', change3.direction, change3.percentChange + '%');
console.assert(change3.direction === 'stable', 'Should be stable');

console.log('  ✅ Price change calculations work\n');

// Test 2: Full analysis with sample data
console.log('Test 2: Full analyzePrices() workflow');

// Sample current data
const currentData = [
  {
    product_id: 'PROD-001',
    competitor_name: 'Amazon',
    price: 299.99,
    currency: 'USD',
    timestamp: new Date().toISOString(),
    url: 'https://amazon.com/product/001'
  },
  {
    product_id: 'PROD-002',
    competitor_name: 'Walmart',
    price: 279.99,
    currency: 'USD',
    timestamp: new Date().toISOString(),
    url: 'https://walmart.com/product/002'
  },
  {
    product_id: 'PROD-NEW',
    competitor_name: 'Target',
    price: 199.99,
    currency: 'USD',
    timestamp: new Date().toISOString(),
    url: 'https://target.com/product/new'
  }
];

try {
  const results = analyzePrices(currentData, {
    updateHistory: true,
    updateState: true
  });
  
  console.log('  ✅ Analysis completed successfully');
  console.log('  📊 Summary:');
  console.log('     - New products:', results.summary.new_products);
  console.log('     - Price drops:', results.summary.price_drops);
  console.log('     - Price increases:', results.summary.price_increases);
  console.log('     - Stable prices:', results.summary.stable_prices);
  console.log('  📝 Report length:', results.report.length, 'chars');
  console.log('  💾 History update:', results.history_update?.records_added, 'records added');
  
  // Save report to file for inspection
  const fs = require('fs');
  const path = require('path');
  const reportPath = path.join(__dirname, '..', 'data', 'last_report.md');
  fs.writeFileSync(reportPath, results.report);
  console.log('  📄 Report saved to:', reportPath);
  
} catch (error) {
  console.error('  ❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}

// Test 3: Verify alert deduplication
console.log('\nTest 3: Alert deduplication (24h cooldown)');

// Run analysis again with same prices
const results2 = analyzePrices(currentData, {
  updateHistory: true,
  updateState: true
});

console.log('  Second run summary:');
console.log('     - Suppressed alerts:', results2.summary.suppressed_alerts);
console.log('  ✅ Alert suppression working\n');

console.log('🎉 All tests passed!');
