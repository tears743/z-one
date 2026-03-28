#!/usr/bin/env node
/**
 * Example Usage: Price Tracking Integration
 * 
 * This script demonstrates how to integrate the scraper with the data store
 * for complete price tracking functionality.
 */

const path = require('path');

// Add project root to path for requires
const projectRoot = path.join(__dirname, '..');
process.chdir(projectRoot);

const { extractPrices, scrapeMultiple } = require('./scraper');

// Try to load data store (may not exist yet)
let DataStore;
try {
  DataStore = require('../utils/data-store');
} catch (e) {
  console.log('⚠️  Data store not available. Running in demo mode.');
  DataStore = null;
}

/**
 * Example product catalog
 */
const EXAMPLE_PRODUCTS = [
  {
    id: 'prod_001',
    name: 'Wireless Headphones',
    urls: {
      amazon: 'https://www.amazon.com/dp/B08N5WRWNW',
      shopify_generic: 'https://example-store.myshopify.com/products/wireless-headphones',
    }
  },
  {
    id: 'prod_002',
    name: 'Smart Watch',
    urls: {
      amazon: 'https://www.amazon.com/dp/B08J5XNC8Y',
    }
  }
];

/**
 * Track prices for a single product across multiple competitors
 */
async function trackProduct(product) {
  console.log(`\n📦 Tracking: ${product.name} (${product.id})`);
  console.log('=' .repeat(60));
  
  const results = [];
  
  for (const [competitor, url] of Object.entries(product.urls)) {
    try {
      console.log(`\n  Scraping ${competitor}...`);
      const competitorResults = await extractPrices([url], competitor, {
        concurrent: 1,
        headless: true,
      });
      
      results.push(...competitorResults);
      
      // Save to data store if available
      if (DataStore && competitorResults[0]?.success) {
        const dataStore = new DataStore();
        await dataStore.recordPrice({
          product_id: product.id,
          competitor_name: competitor,
          price: competitorResults[0].price,
          currency: competitorResults[0].currency,
          url: url,
          status: 'success'
        });
        console.log('  💾 Saved to data store');
      }
      
    } catch (error) {
      console.error(`  ❌ Error scraping ${competitor}: ${error.message}`);
      results.push({
        competitor,
        product: product.name,
        price: null,
        currency: null,
        url,
        timestamp: new Date().toISOString(),
        success: false,
        error: error.message,
      });
    }
  }
  
  return results;
}

/**
 * Track all products in catalog
 */
async function trackAllProducts(products) {
  console.log('\n🚀 Starting Price Tracking Session');
  console.log(`   Products: ${products.length}`);
  console.log(`   Time: ${new Date().toISOString()}`);
  
  const allResults = [];
  
  for (const product of products) {
    const results = await trackProduct(product);
    allResults.push(...results);
    
    // Delay between products
    await new Promise(r => setTimeout(r, 2000));
  }
  
  return allResults;
}

/**
 * Generate price comparison report
 */
function generateReport(results) {
  console.log('\n\n📊 PRICE TRACKING REPORT');
  console.log('=' .repeat(70));
  
  // Group by product
  const byProduct = results.reduce((acc, result) => {
    const key = result.product || 'Unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(result);
    return acc;
  }, {});
  
  for (const [productName, productResults] of Object.entries(byProduct)) {
    console.log(`\n📝 ${productName}`);
    console.log('-'.repeat(70));
    
    for (const result of productResults) {
      if (result.success) {
        console.log(`  ✅ ${result.competitor.padEnd(20)} ${result.currency} ${result.price.toFixed(2)}`);
      } else {
        console.log(`  ❌ ${result.competitor.padEnd(20)} ERROR: ${result.error}`);
      }
    }
  }
  
  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log('\n' + '='.repeat(70));
  console.log(`Summary: ${successful} successful, ${failed} failed`);
  console.log('='.repeat(70));
}

/**
 * Demo mode with mock data
 */
async function runDemo() {
  console.log('\n🎮 RUNNING DEMO MODE');
  console.log('   (No actual scraping - using mock data)');
  console.log('');
  
  const mockResults = [
    {
      competitor: 'amazon',
      product: 'Wireless Headphones',
      price: 79.99,
      currency: 'USD',
      url: 'https://amazon.com/dp/B08N5WRWNW',
      timestamp: new Date().toISOString(),
      success: true,
      duration: 3456
    },
    {
      competitor: 'shopify_generic',
      product: 'Wireless Headphones',
      price: 89.99,
      currency: 'USD',
      url: 'https://example-store.myshopify.com/products/wireless-headphones',
      timestamp: new Date().toISOString(),
      success: true,
      duration: 2890
    },
    {
      competitor: 'amazon',
      product: 'Smart Watch',
      price: 249.99,
      currency: 'USD',
      url: 'https://amazon.com/dp/B08J5XNC8Y',
      timestamp: new Date().toISOString(),
      success: true,
      duration: 4123
    }
  ];
  
  generateReport(mockResults);
  
  console.log('\n💡 To run actual scrapes:');
  console.log('   1. Install dependencies: npm install playwright');
  console.log('   2. Install browser: npx playwright install chromium');
  console.log('   3. Update URLs in config or script');
  console.log('   4. Run: node scripts/example-usage.js --live');
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const isLive = args.includes('--live');
  const isDemo = args.includes('--demo') || !isLive;
  
  if (isDemo) {
    await runDemo();
    return;
  }
  
  // Live scraping mode
  console.log('🔴 LIVE SCRAPING MODE');
  console.log('   This will perform actual web requests\n');
  
  try {
    const results = await trackAllProducts(EXAMPLE_PRODUCTS);
    generateReport(results);
    
    // Save detailed results
    const fs = require('fs').promises;
    const outputPath = path.join(projectRoot, 'data', 'last_scrape_results.json');
    await fs.writeFile(
      outputPath,
      JSON.stringify(results, null, 2)
    );
    console.log(`\n💾 Results saved to: ${outputPath}`);
    
  } catch (error) {
    console.error('\n❌ Scraping failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  trackProduct,
  trackAllProducts,
  generateReport,
  EXAMPLE_PRODUCTS
};
