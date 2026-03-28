#!/usr/bin/env node
/**
 * Price Analysis Module
 * 
 * Performs delta detection between current price snapshots and historical data.
 * Updates price_history.json with atomic operations and generates change reports.
 * 
 * Usage: node analyze_prices.js [snapshot_file_path]
 * Default snapshot: ./data/price_snapshot.json
 */

const fs = require('fs').promises;
const path = require('path');
const { existsSync } = require('fs');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  SNAPSHOT_PATH: process.argv[2] || path.join(__dirname, '..', 'data', 'price_snapshot.json'),
  HISTORY_PATH: path.join(__dirname, '..', 'data', 'price_history.json'),
  REPORT_PATH: path.join(__dirname, '..', 'reports', `price_analysis_${new Date().toISOString().split('T')[0]}.json`),
  SCHEMA_VERSION: '1.0.0',
  MAX_HISTORY_PER_PRODUCT: 100,
  PRECISION: 2 // Decimal places for price comparisons
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a unique change ID
 * @param {string} productId - Product identifier
 * @param {number} sequence - Change sequence number
 * @returns {string} - Unique change ID
 */
function generateChangeId(productId, sequence) {
  const timestamp = Date.now().toString(36);
  return `chg-${productId}-${sequence.toString().padStart(3, '0')}-${timestamp}`;
}

/**
 * Generate ISO 8601 timestamp
 * @returns {string} - ISO timestamp
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Calculate percentage change between two prices
 * @param {number} oldPrice - Previous price
 * @param {number} newPrice - Current price
 * @returns {number} - Percentage change
 */
function calculatePercentageChange(oldPrice, newPrice) {
  if (oldPrice === 0) return 0;
  return parseFloat((((newPrice - oldPrice) / oldPrice) * 100).toFixed(CONFIG.PRECISION));
}

/**
 * Determine change type based on price delta
 * @param {number} oldPrice - Previous price
 * @param {number} newPrice - Current price
 * @param {boolean} wasAvailable - Previous availability
 * @param {boolean} isAvailable - Current availability
 * @returns {string} - Change type classification
 */
function determineChangeType(oldPrice, newPrice, wasAvailable, isAvailable) {
  if (!wasAvailable && isAvailable) return 'back_in_stock';
  if (wasAvailable && !isAvailable) return 'out_of_stock';
  if (newPrice > oldPrice) return 'price_increase';
  if (newPrice < oldPrice) return 'price_drop';
  return 'no_change';
}

/**
 * Format currency amount
 * @param {number} amount - Price amount
 * @param {string} currency - Currency code
 * @returns {string} - Formatted price string
 */
function formatPrice(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency
  }).format(amount);
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read and parse JSON file with error handling
 * @param {string} filePath - Path to JSON file
 * @returns {Promise<Object>} - Parsed JSON data
 */
async function readJsonFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in file: ${filePath}`);
    }
    throw error;
  }
}

/**
 * Write JSON file with atomic operation (write to temp, then rename)
 * @param {string} filePath - Target file path
 * @param {Object} data - Data to write
 */
async function writeJsonFileAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.tmp_${path.basename(filePath)}_${Date.now()}`);
  
  try {
    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });
    
    // Write to temporary file
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
    
    // Atomic rename operation
    await fs.rename(tempPath, filePath);
    
    console.log(`✓ Atomic write completed: ${filePath}`);
  } catch (error) {
    // Cleanup temp file if exists
    try {
      await fs.unlink(tempPath);
    } catch {}
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICE ANALYSIS ENGINE
// ─────────────────────────────────────────────────────────────────────────────

class PriceAnalyzer {
  constructor() {
    this.changes = [];
    this.statistics = {
      totalProducts: 0,
      productsWithChanges: 0,
      priceDrops: 0,
      priceIncreases: 0,
      stockChanges: 0,
      newProducts: 0
    };
  }

  /**
   * Initialize or load existing history
   * @returns {Promise<Object>} - History data structure
   */
  async loadHistory() {
    if (!existsSync(CONFIG.HISTORY_PATH)) {
      console.log('⚠ No existing history found. Creating new history structure.');
      return this.createEmptyHistory();
    }
    
    const history = await readJsonFile(CONFIG.HISTORY_PATH);
    console.log(`✓ Loaded history: ${Object.keys(history.products || {}).length} products tracked`);
    return history;
  }

  /**
   * Create empty history structure
   * @returns {Object} - Empty history object
   */
  createEmptyHistory() {
    return {
      schema_version: CONFIG.SCHEMA_VERSION,
      description: 'Price history storage with atomic product entries, delta tracking, and change audit trail',
      generated_at: getTimestamp(),
      products: {},
      metadata: {
        total_products_tracked: 0,
        products_with_changes: 0,
        last_scan_timestamp: getTimestamp(),
        next_scan_scheduled: null,
        storage: {
          format: 'atomic_product_entries',
          index_strategy: 'product_id_hashmap',
          compression: 'none',
          max_history_per_product: CONFIG.MAX_HISTORY_PER_PRODUCT
        },
        data_quality: {
          integrity_check: 'passed',
          orphaned_records: 0,
          stale_entries: 0
        }
      }
    };
  }

  /**
   * Compare current snapshot with history and detect changes
   * @param {Object} snapshot - Current price snapshot
   * @param {Object} history - Historical price data
   * @returns {Object} - Updated history with detected changes
   */
  analyzeDeltas(snapshot, history) {
    const timestamp = getTimestamp();
    const updatedHistory = JSON.parse(JSON.stringify(history)); // Deep clone
    
    console.log('\n📊 ANALYZING PRICE DELTAS...\n');
    
    for (const [productId, currentData] of Object.entries(snapshot.products || {})) {
      this.statistics.totalProducts++;
      
      const existingProduct = updatedHistory.products[productId];
      
      if (!existingProduct) {
        // New product - initialize tracking
        console.log(`🆕 New product detected: ${productId} - ${currentData.product_name}`);
        updatedHistory.products[productId] = this.initializeProduct(currentData, timestamp);
        this.statistics.newProducts++;
        continue;
      }
      
      // Compare current vs previous
      const change = this.detectChange(existingProduct, currentData, timestamp);
      
      if (change) {
        this.statistics.productsWithChanges++;
        this.changes.push(change);
        
        // Update product history
        this.updateProductHistory(existingProduct, currentData, change, timestamp);
        
        // Log change
        this.logChange(change);
      } else {
        // No price change - just update timestamp and availability if needed
        existingProduct.pricing.current.timestamp = timestamp;
        if (currentData.availability !== undefined) {
          existingProduct.pricing.current.is_available = currentData.availability;
        }
      }
    }
    
    // Update metadata
    updatedHistory.metadata.total_products_tracked = Object.keys(updatedHistory.products).length;
    updatedHistory.metadata.products_with_changes = this.statistics.productsWithChanges;
    updatedHistory.metadata.last_scan_timestamp = timestamp;
    
    return updatedHistory;
  }

  /**
   * Initialize a new product entry
   * @param {Object} snapshotData - Snapshot data for new product
   * @param {string} timestamp - ISO timestamp
   * @returns {Object} - New product entry
   */
  initializeProduct(snapshotData, timestamp) {
    const amount = parseFloat(snapshotData.price);
    
    return {
      product_id: snapshotData.product_id,
      product_name: snapshotData.product_name,
      pricing: {
        current: {
          amount: amount,
          currency: snapshotData.currency || 'USD',
          timestamp: timestamp,
          source: snapshotData.source || 'api',
          is_available: snapshotData.availability !== false
        },
        previous: {
          amount: amount,
          currency: snapshotData.currency || 'USD',
          timestamp: timestamp,
          source: snapshotData.source || 'api',
          is_available: snapshotData.availability !== false
        }
      },
      statistics: {
        total_changes: 0,
        first_tracked: timestamp,
        last_updated: timestamp,
        lowest_price: { amount: amount, timestamp: timestamp },
        highest_price: { amount: amount, timestamp: timestamp },
        average_price: amount
      },
      change_history: []
    };
  }

  /**
   * Detect if there's a meaningful change between current and historical data
   * @param {Object} existing - Existing product data
   * @param {Object} current - Current snapshot data
   * @param {string} timestamp - ISO timestamp
   * @returns {Object|null} - Change object or null if no change
   */
  detectChange(existing, current, timestamp) {
    const oldPrice = existing.pricing.current.amount;
    const newPrice = parseFloat(current.price);
    const oldAvailability = existing.pricing.current.is_available;
    const newAvailability = current.availability !== false;
    
    // Check for price change (with precision tolerance)
    const priceChanged = Math.abs(newPrice - oldPrice) >= Math.pow(10, -CONFIG.PRECISION);
    const availabilityChanged = oldAvailability !== newAvailability;
    
    if (!priceChanged && !availabilityChanged) {
      return null;
    }
    
    const changeType = determineChangeType(oldPrice, newPrice, oldAvailability, newAvailability);
    const absoluteChange = parseFloat((newPrice - oldPrice).toFixed(CONFIG.PRECISION));
    const percentageChange = calculatePercentageChange(oldPrice, newPrice);
    
    return {
      change_id: generateChangeId(current.product_id, existing.statistics.total_changes + 1),
      product_id: current.product_id,
      product_name: current.product_name,
      timestamp: timestamp,
      old_amount: oldPrice,
      new_amount: newPrice,
      absolute_change: absoluteChange,
      percentage_change: percentageChange,
      change_type: changeType,
      old_availability: oldAvailability,
      new_availability: newAvailability,
      trigger: 'scheduled_scan',
      source: current.source || 'api',
      notified: false,
      metadata: {
        competitor_url: current.url,
        extracted_at: current.extracted_at
      }
    };
  }

  /**
   * Update product history with new change
   * @param {Object} product - Product entry to update
   * @param {Object} currentData - Current snapshot data
   * @param {Object} change - Detected change
   * @param {string} timestamp - ISO timestamp
   */
  updateProductHistory(product, currentData, change, timestamp) {
    // Shift current to previous
    product.pricing.previous = { ...product.pricing.current };
    
    // Update current
    product.pricing.current = {
      amount: change.new_amount,
      currency: currentData.currency || product.pricing.current.currency,
      timestamp: timestamp,
      source: currentData.source || 'api',
      is_available: change.new_availability
    };
    
    // Update statistics
    product.statistics.total_changes++;
    product.statistics.last_updated = timestamp;
    
    // Update lowest/highest prices
    if (change.new_amount < product.statistics.lowest_price.amount) {
      product.statistics.lowest_price = { amount: change.new_amount, timestamp: timestamp };
    }
    if (change.new_amount > product.statistics.highest_price.amount) {
      product.statistics.highest_price = { amount: change.new_amount, timestamp: timestamp };
    }
    
    // Recalculate average (simple running average)
    const historyCount = product.change_history.length + 1;
    const currentAvg = product.statistics.average_price;
    product.statistics.average_price = parseFloat(
      ((currentAvg * historyCount + change.new_amount) / (historyCount + 1)).toFixed(CONFIG.PRECISION)
    );
    
    // Add to change history (with limit)
    product.change_history.unshift(change);
    if (product.change_history.length > CONFIG.MAX_HISTORY_PER_PRODUCT) {
      product.change_history = product.change_history.slice(0, CONFIG.MAX_HISTORY_PER_PRODUCT);
    }
  }

  /**
   * Log a detected change to console
   * @param {Object} change - Change object
   */
  logChange(change) {
    const symbol = change.change_type === 'price_drop' ? '🔻' :
                   change.change_type === 'price_increase' ? '🔺' :
                   change.change_type === 'back_in_stock' ? '✅' :
                   change.change_type === 'out_of_stock' ? '❌' : '📝';
    
    const sign = change.absolute_change >= 0 ? '+' : '';
    
    console.log(`${symbol} ${change.product_name} (${change.product_id})`);
    console.log(`   ${formatPrice(change.old_amount)} → ${formatPrice(change.new_amount)}`);
    console.log(`   Change: ${sign}${change.absolute_change} (${sign}${change.percentage_change}%)`);
    console.log(`   Type: ${change.change_type}`);
    console.log('');
    
    // Update statistics counters
    if (change.change_type === 'price_drop') this.statistics.priceDrops++;
    if (change.change_type === 'price_increase') this.statistics.priceIncreases++;
    if (['back_in_stock', 'out_of_stock'].includes(change.change_type)) this.statistics.stockChanges++;
  }

  /**
   * Generate analysis report
   * @returns {Object} - Report object
   */
  generateReport() {
    return {
      report_id: `rpt-${Date.now().toString(36)}`,
      generated_at: getTimestamp(),
      summary: {
        total_products_analyzed: this.statistics.totalProducts,
        products_with_changes: this.statistics.productsWithChanges,
        new_products: this.statistics.newProducts,
        price_drops: this.statistics.priceDrops,
        price_increases: this.statistics.priceIncreases,
        stock_changes: this.statistics.stockChanges
      },
      changes: this.changes,
      recommendations: this.generateRecommendations(),
      alerts: this.generateAlerts()
    };
  }

  /**
   * Generate price recommendations based on analysis
   * @returns {Array} - Array of recommendations
   */
  generateRecommendations() {
    const recommendations = [];
    
    // Significant price drops (> 15%)
    const significantDrops = this.changes.filter(c => 
      c.change_type === 'price_drop' && c.percentage_change <= -15
    );
    
    if (significantDrops.length > 0) {
      recommendations.push({
        type: 'opportunity',
        priority: 'high',
        message: `${significantDrops.length} products have significant price drops (>15%)`,
        products: significantDrops.map(c => c.product_id)
      });
    }
    
    // Price volatility (multiple changes in short period)
    const volatileProducts = this.changes.filter(c => 
      Math.abs(c.percentage_change) > 10
    );
    
    if (volatileProducts.length > 0) {
      recommendations.push({
        type: 'monitoring',
        priority: 'medium',
        message: `${volatileProducts.length} products showing high price volatility`,
        products: volatileProducts.map(c => c.product_id)
      });
    }
    
    return recommendations;
  }

  /**
   * Generate alerts for significant events
   * @returns {Array} - Array of alerts
   */
  generateAlerts() {
    const alerts = [];
    
    this.changes.forEach(change => {
      if (change.change_type === 'price_drop' && change.percentage_change <= -20) {
        alerts.push({
          severity: 'critical',
          type: 'major_price_drop',
          product_id: change.product_id,
          message: `Major price drop detected: ${change.product_name}`,
          details: {
            old_price: change.old_amount,
            new_price: change.new_amount,
            drop_percentage: Math.abs(change.percentage_change)
          }
        });
      }
      
      if (change.change_type === 'back_in_stock') {
        alerts.push({
          severity: 'info',
          type: 'back_in_stock',
          product_id: change.product_id,
          message: `Product back in stock: ${change.product_name}`,
          details: { price: change.new_amount }
        });
      }
    });
    
    return alerts;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║           PRICE ANALYSIS MODULE v1.0.0                    ║');
  console.log('║     Delta Detection & Historical Update Engine           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  
  const analyzer = new PriceAnalyzer();
  
  try {
    // Validate snapshot exists
    if (!existsSync(CONFIG.SNAPSHOT_PATH)) {
      console.error(`❌ Snapshot file not found: ${CONFIG.SNAPSHOT_PATH}`);
      console.log('Usage: node analyze_prices.js [path_to_snapshot.json]');
      process.exit(1);
    }
    
    // Load data
    console.log(`📁 Loading snapshot: ${CONFIG.SNAPSHOT_PATH}`);
    const snapshot = await readJsonFile(CONFIG.SNAPSHOT_PATH);
    console.log(`   Found ${Object.keys(snapshot.products || {}).length} products in snapshot\n`);
    
    const history = await analyzer.loadHistory();
    
    // Perform analysis
    const updatedHistory = analyzer.analyzeDeltas(snapshot, history);
    
    // Atomic write to history file
    console.log('\n💾 Persisting updates...');
    await writeJsonFileAtomic(CONFIG.HISTORY_PATH, updatedHistory);
    
    // Generate and save report
    const report = analyzer.generateReport();
    await writeJsonFileAtomic(CONFIG.REPORT_PATH, report);
    console.log(`✓ Report saved: ${CONFIG.REPORT_PATH}`);
    
    // Output summary
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('                     ANALYSIS SUMMARY                       ');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Total Products Analyzed: ${report.summary.total_products_analyzed}`);
    console.log(`Products with Changes:   ${report.summary.products_with_changes}`);
    console.log(`New Products:            ${report.summary.new_products}`);
    console.log(`Price Drops:             ${report.summary.price_drops}`);
    console.log(`Price Increases:         ${report.summary.price_increases}`);
    console.log(`Stock Changes:           ${report.summary.stock_changes}`);
    console.log('═══════════════════════════════════════════════════════════\n');
    
    // Output detected changes as JSON for downstream processing
    if (report.summary.products_with_changes > 0) {
      console.log('📤 Outputting changes for downstream processing...\n');
      console.log(JSON.stringify({
        status: 'success',
        changes_detected: true,
        change_count: report.summary.products_with_changes,
        changes: report.changes.map(c => ({
          product_id: c.product_id,
          change_type: c.change_type,
          price_delta: c.absolute_change,
          percentage: c.percentage_change
        }))
      }, null, 2));
    } else {
      console.log('✅ No price changes detected.\n');
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ ANALYSIS FAILED');
    console.error(`Error: ${error.message}`);
    
    if (process.env.DEBUG) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

// Run main if called directly
if (require.main === module) {
  main();
}

// Export for testing/module usage
module.exports = {
  PriceAnalyzer,
  CONFIG,
  calculatePercentageChange,
  determineChangeType,
  generateChangeId
};
