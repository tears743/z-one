/**
 * Comparison & Alert Engine
 * 
 * Analyzes current price data against historical records to detect:
 * - New products
 * - Removed products  
 * - Price increases/decreases
 * 
 * Generates formatted markdown reports and manages alert deduplication.
 * 
 * @module analyzer
 * @version 1.0.0
 */

const dataStore = require('../utils/data-store.js');
const path = require('path');
const fs = require('fs');

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  ALERT_COOLDOWN_HOURS: 24,
  HISTORY_RETENTION_DAYS: 30,
  PRICE_CHANGE_THRESHOLD: 0.01, // 1% minimum change to report
  REPORT_SECTIONS: {
    NEW_PRODUCTS: '✨ New Products',
    REMOVED_PRODUCTS: '🗑️ Removed Products',
    PRICE_DROPS: '🔻 Price Drops',
    PRICE_INCREASES: '🔺 Price Increases',
    STABLE_PRICES: '➡️ Stable Prices',
    SUMMARY: '📊 Summary'
  }
};

// ============================================================================
// Error Classes
// ============================================================================

class AnalyzerError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'AnalyzerError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a unique key for product+competitor combination
 * @param {Object} item - Price item
 * @returns {string} Unique key
 */
function createProductKey(item) {
  return `${item.competitor_name}:${item.product_id}`;
}

/**
 * Parse price value, handling various formats
 * @param {*} price - Price value (number or string)
 * @returns {number|null} Parsed price or null
 */
function parsePrice(price) {
  if (price === null || price === undefined) return null;
  if (typeof price === 'number') return price;
  
  // Remove currency symbols and parse
  const cleaned = String(price)
    .replace(/[^0-9.,]/g, '')
    .replace(/,/g, '');
  
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Calculate percentage change between two prices
 * @param {number} oldPrice - Previous price
 * @param {number} newPrice - Current price
 * @returns {Object} Change info
 */
function calculatePriceChange(oldPrice, newPrice) {
  const oldParsed = parsePrice(oldPrice);
  const newParsed = parsePrice(newPrice);
  
  if (oldParsed === null || newParsed === null) {
    return { 
      changed: false, 
      percentChange: 0, 
      absoluteChange: 0,
      direction: 'unknown'
    };
  }
  
  const absoluteChange = newParsed - oldParsed;
  const percentChange = oldParsed !== 0 
    ? (absoluteChange / oldParsed) * 100 
    : 0;
  
  const direction = absoluteChange > 0 
    ? 'increase' 
    : absoluteChange < 0 
      ? 'drop' 
      : 'stable';
  
  return {
    changed: Math.abs(percentChange) >= (CONFIG.PRICE_CHANGE_THRESHOLD * 100),
    percentChange: parseFloat(percentChange.toFixed(2)),
    absoluteChange: parseFloat(absoluteChange.toFixed(2)),
    direction,
    oldPrice: oldParsed,
    newPrice: newParsed
  };
}

/**
 * Check if an alert should be suppressed (within cooldown period)
 * @param {Object} item - Current price item
 * @param {Array} history - Historical records
 * @returns {boolean} True if alert should be suppressed
 */
function shouldSuppressAlert(item, history) {
  const productKey = createProductKey(item);
  const cutoffTime = new Date();
  cutoffTime.setHours(cutoffTime.getHours() - CONFIG.ALERT_COOLDOWN_HOURS);
  
  // Find recent alerts for this product
  const recentAlerts = history.filter(record => {
    const key = createProductKey(record);
    const recordTime = new Date(record.timestamp);
    return key === productKey && 
           record._alert_sent === true &&
           recordTime > cutoffTime;
  });
  
  if (recentAlerts.length === 0) return false;
  
  // Check if price is the same as last alerted price
  const lastAlert = recentAlerts.sort((a, b) => 
    new Date(b.timestamp) - new Date(a.timestamp)
  )[0];
  
  const currentPrice = parsePrice(item.price);
  const lastAlertedPrice = parsePrice(lastAlert.price);
  
  return currentPrice === lastAlertedPrice;
}

/**
 * Get the most recent historical record for a product
 * @param {Object} item - Current price item
 * @param {Array} history - Historical records
 * @returns {Object|null} Most recent record or null
 */
function getLatestHistoricalRecord(item, history) {
  const productKey = createProductKey(item);
  
  const matchingRecords = history
    .filter(record => createProductKey(record) === productKey)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  return matchingRecords.length > 0 ? matchingRecords[0] : null;
}

/**
 * Filter history to keep only last N days
 * @param {Array} records - All historical records
 * @param {number} days - Number of days to keep
 * @returns {Array} Filtered records
 */
function filterHistoryByAge(records, days) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  return records.filter(record => {
    const recordDate = new Date(record.timestamp);
    return recordDate >= cutoffDate;
  });
}

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Analyze current data against historical records
 * @param {Array} currentData - Array of current price items
 * @param {Array} history - Array of historical records
 * @returns {Object} Analysis results
 */
function performAnalysis(currentData, history) {
  const results = {
    newProducts: [],
    removedProducts: [],
    priceDrops: [],
    priceIncreases: [],
    stablePrices: [],
    suppressedAlerts: [],
    allChanges: []
  };
  
  const currentKeys = new Set(currentData.map(createProductKey));
  const historyKeys = new Set(history.map(createProductKey));
  
  // Detect new products
  currentData.forEach(item => {
    const key = createProductKey(item);
    if (!historyKeys.has(key)) {
      results.newProducts.push({
        ...item,
        detected_at: new Date().toISOString()
      });
    }
  });
  
  // Detect removed products
  history.forEach(record => {
    const key = createProductKey(record);
    if (!currentKeys.has(key)) {
      // Only add if not already in removed products
      const alreadyRemoved = results.removedProducts.some(
        r => createProductKey(r) === key
      );
      if (!alreadyRemoved) {
        results.removedProducts.push({
          ...record,
          removed_at: new Date().toISOString()
        });
      }
    }
  });
  
  // Analyze price changes for existing products
  currentData.forEach(item => {
    const key = createProductKey(item);
    if (!historyKeys.has(key)) return; // Skip new products
    
    const latestHistory = getLatestHistoricalRecord(item, history);
    if (!latestHistory) return;
    
    const change = calculatePriceChange(latestHistory.price, item.price);
    
    const changeRecord = {
      ...item,
      previous_price: latestHistory.price,
      previous_timestamp: latestHistory.timestamp,
      price_change: change,
      analyzed_at: new Date().toISOString()
    };
    
    // Check for alert suppression
    if (change.changed && shouldSuppressAlert(item, history)) {
      results.suppressedAlerts.push({
        ...changeRecord,
        suppression_reason: 'Same price alerted within 24h'
      });
      return;
    }
    
    if (change.direction === 'drop') {
      results.priceDrops.push(changeRecord);
    } else if (change.direction === 'increase') {
      results.priceIncreases.push(changeRecord);
    } else {
      results.stablePrices.push(changeRecord);
    }
    
    if (change.changed) {
      results.allChanges.push(changeRecord);
    }
  });
  
  return results;
}

// ============================================================================
// Report Generation
// ============================================================================

/**
 * Generate markdown report from analysis results
 * @param {Object} results - Analysis results
 * @param {Object} metadata - Report metadata
 * @returns {string} Formatted markdown report
 */
function generateMarkdownReport(results, metadata = {}) {
  const now = new Date().toISOString();
  const { newProducts, removedProducts, priceDrops, priceIncreases, stablePrices, suppressedAlerts } = results;
  
  let report = [];
  
  // Header
  report.push('# 📊 Price Change Report');
  report.push('');
  report.push(`**Generated:** ${now}`);
  if (metadata.run_id) report.push(`**Run ID:** ${metadata.run_id}`);
  if (metadata.total_products_checked) {
    report.push(`**Products Checked:** ${metadata.total_products_checked}`);
  }
  report.push('');
  report.push('---');
  report.push('');
  
  // Summary Section
  report.push(`## ${CONFIG.REPORT_SECTIONS.SUMMARY}`);
  report.push('');
  report.push('| Metric | Count |');
  report.push('|--------|-------|');
  report.push(`| 🆕 New Products | ${newProducts.length} |`);
  report.push(`| 🗑️ Removed Products | ${removedProducts.length} |`);
  report.push(`| 🔻 Price Drops | ${priceDrops.length} |`);
  report.push(`| 🔺 Price Increases | ${priceIncreases.length} |`);
  report.push(`| ➡️ Stable Prices | ${stablePrices.length} |`);
  report.push(`| 🚫 Suppressed Alerts | ${suppressedAlerts.length} |`);
  report.push('');
  report.push('---');
  report.push('');
  
  // New Products Section
  if (newProducts.length > 0) {
    report.push(`## ${CONFIG.REPORT_SECTIONS.NEW_PRODUCTS}`);
    report.push('');
    report.push('| Competitor | Product ID | Price | Currency | URL |');
    report.push('|------------|------------|-------|----------|-----|');
    newProducts.forEach(item => {
      const url = item.url ? `[Link](${item.url})` : 'N/A';
      report.push(`| ${item.competitor_name} | ${item.product_id} | ${item.price} | ${item.currency} | ${url} |`);
    });
    report.push('');
    report.push('---');
    report.push('');
  }
  
  // Removed Products Section
  if (removedProducts.length > 0) {
    report.push(`## ${CONFIG.REPORT_SECTIONS.REMOVED_PRODUCTS}`);
    report.push('');
    report.push('| Competitor | Product ID | Last Price | Last Seen |');
    report.push('|------------|------------|------------|-----------|');
    removedProducts.forEach(item => {
      const lastSeen = new Date(item.timestamp).toLocaleDateString();
      report.push(`| ${item.competitor_name} | ${item.product_id} | ${item.price} ${item.currency} | ${lastSeen} |`);
    });
    report.push('');
    report.push('---');
    report.push('');
  }
  
  // Price Drops Section
  if (priceDrops.length > 0) {
    report.push(`## ${CONFIG.REPORT_SECTIONS.PRICE_DROPS}`);
    report.push('');
    report.push('🎉 Great news! Prices have dropped on these items:');
    report.push('');
    report.push('| Competitor | Product ID | Old Price | New Price | Change | % Change |');
    report.push('|------------|------------|-----------|-----------|--------|----------|');
    priceDrops.forEach(item => {
      const change = item.price_change;
      const emoji = change.percentChange <= -10 ? '🚨' : change.percentChange <= -5 ? '🔥' : '✅';
      report.push(`| ${item.competitor_name} | ${item.product_id} | ${change.oldPrice} | ${change.newPrice} | ${change.absoluteChange} | ${emoji} ${change.percentChange}% |`);
    });
    report.push('');
    report.push('---');
    report.push('');
  }
  
  // Price Increases Section
  if (priceIncreases.length > 0) {
    report.push(`## ${CONFIG.REPORT_SECTIONS.PRICE_INCREASES}`);
    report.push('');
    report.push('⚠️ Prices have increased on these items:');
    report.push('');
    report.push('| Competitor | Product ID | Old Price | New Price | Change | % Change |');
    report.push('|------------|------------|-----------|-----------|--------|----------|');
    priceIncreases.forEach(item => {
      const change = item.price_change;
      const emoji = change.percentChange >= 10 ? '⚠️' : change.percentChange >= 5 ? '📈' : '⬆️';
      report.push(`| ${item.competitor_name} | ${item.product_id} | ${change.oldPrice} | ${change.newPrice} | +${change.absoluteChange} | ${emoji} +${change.percentChange}% |`);
    });
    report.push('');
    report.push('---');
    report.push('');
  }
  
  // Suppressed Alerts Section (if any)
  if (suppressedAlerts.length > 0) {
    report.push('## 🚫 Suppressed Alerts (24h Cooldown)');
    report.push('');
    report.push('These changes were detected but not alerted (same price change within 24 hours):');
    report.push('');
    report.push('| Competitor | Product ID | Price | Reason |');
    report.push('|------------|------------|-------|--------|');
    suppressedAlerts.slice(0, 5).forEach(item => {
      report.push(`| ${item.competitor_name} | ${item.product_id} | ${item.price} | ${item.suppression_reason} |`);
    });
    if (suppressedAlerts.length > 5) {
      report.push(`| ... | ... | ... | *${suppressedAlerts.length - 5} more suppressed* |`);
    }
    report.push('');
    report.push('---');
    report.push('');
  }
  
  // Footer
  report.push('## ℹ️ About This Report');
  report.push('');
  report.push(`- **Alert Cooldown:** ${CONFIG.ALERT_COOLDOWN_HOURS} hours (prevents duplicate alerts for same price)`);
  report.push(`- **History Retention:** ${CONFIG.HISTORY_RETENTION_DAYS} days`);
  report.push(`- **Minimum Change Threshold:** ${CONFIG.PRICE_CHANGE_THRESHOLD * 100}%`);
  report.push('');
  report.push('---');
  report.push(`*Generated by Price Tracking System* 🚀`);
  
  return report.join('\n');
}

// ============================================================================
// Data Update Functions
// ============================================================================

/**
 * Update price history with new data
 * @param {Array} currentData - Current price items
 * @param {Object} options - Update options
 * @returns {Object} Update result
 */
function updatePriceHistory(currentData, options = {}) {
  const { 
    retentionDays = CONFIG.HISTORY_RETENTION_DAYS,
    markAlerts = true 
  } = options;
  
  // Read current history
  const historyData = dataStore.readPriceHistory();
  let allRecords = [...historyData.records];
  
  // Enrich and add new records
  const enrichedNewData = currentData.map(item => ({
    record_id: dataStore.generateUUID(),
    ...item,
    timestamp: item.timestamp || new Date().toISOString(),
    _ingested_at: new Date().toISOString(),
    _alert_sent: markAlerts ? true : undefined
  }));
  
  // Add new records
  allRecords.push(...enrichedNewData);
  
  // Filter to retention period
  const filteredRecords = filterHistoryByAge(allRecords, retentionDays);
  
  // Update history file
  const updatedData = {
    ...historyData,
    records: filteredRecords,
    last_updated: new Date().toISOString(),
    record_count: filteredRecords.length
  };
  
  const writeResult = dataStore.atomicWrite(
    path.join(dataStore.CONFIG.DATA_DIR, dataStore.CONFIG.PRICE_HISTORY_FILE),
    updatedData,
    true
  );
  
  return {
    success: true,
    records_added: enrichedNewData.length,
    records_removed: allRecords.length - filteredRecords.length,
    total_records: filteredRecords.length,
    ...writeResult
  };
}

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Main analysis function - compares current data against history
 * @param {Array} currentData - Array of current price objects
 * @param {Object} options - Analysis options
 * @returns {Object} Analysis results with report
 */
function analyzePrices(currentData, options = {}) {
  // Validate input
  if (!Array.isArray(currentData)) {
    throw new AnalyzerError(
      'currentData must be an array',
      'INVALID_INPUT',
      { received: typeof currentData }
    );
  }
  
  // Validate each record has required fields
  currentData.forEach((item, index) => {
    const required = ['product_id', 'competitor_name', 'price', 'currency'];
    const missing = required.filter(field => !(field in item));
    if (missing.length > 0) {
      throw new AnalyzerError(
        `Record at index ${index} is missing required fields: ${missing.join(', ')}`,
        'INVALID_RECORD',
        { index, missing, record: item }
      );
    }
  });
  
  // Load historical data
  const historyData = dataStore.readPriceHistory();
  const history = historyData.records || [];
  
  // Perform analysis
  const results = performAnalysis(currentData, history);
  
  // Generate report
  const metadata = {
    run_id: dataStore.generateUUID(),
    total_products_checked: currentData.length,
    history_records_available: history.length,
    ...options.metadata
  };
  
  const report = generateMarkdownReport(results, metadata);
  
  // Update history with new data
  let updateResult = null;
  if (options.updateHistory !== false) {
    updateResult = updatePriceHistory(currentData, {
      retentionDays: options.retentionDays || CONFIG.HISTORY_RETENTION_DAYS,
      markAlerts: true
    });
  }
  
  // Update state with analysis info
  if (options.updateState !== false) {
    dataStore.updateState({
      data_state: {
        last_record_count: updateResult?.total_records || history.length,
        last_analysis_at: new Date().toISOString()
      },
      last_analysis: {
        run_id: metadata.run_id,
        products_checked: currentData.length,
        changes_detected: results.allChanges.length,
        new_products: results.newProducts.length,
        price_drops: results.priceDrops.length,
        price_increases: results.priceIncreases.length,
        timestamp: new Date().toISOString()
      }
    });
  }
  
  return {
    success: true,
    run_id: metadata.run_id,
    timestamp: new Date().toISOString(),
    report,
    summary: {
      new_products: results.newProducts.length,
      removed_products: results.removedProducts.length,
      price_drops: results.priceDrops.length,
      price_increases: results.priceIncreases.length,
      stable_prices: results.stablePrices.length,
      suppressed_alerts: results.suppressedAlerts.length,
      total_changes: results.allChanges.length
    },
    details: {
      new_products: results.newProducts,
      removed_products: results.removedProducts,
      price_drops: results.priceDrops,
      price_increases: results.priceIncreases,
      suppressed_alerts: results.suppressedAlerts
    },
    history_update: updateResult
  };
}

// ============================================================================
// Export Module
// ============================================================================

module.exports = {
  // Main function
  analyzePrices,
  
  // Configuration
  CONFIG,
  
  // Error classes
  AnalyzerError,
  
  // Helper functions (exported for testing)
  createProductKey,
  parsePrice,
  calculatePriceChange,
  shouldSuppressAlert,
  getLatestHistoricalRecord,
  filterHistoryByAge,
  performAnalysis,
  generateMarkdownReport,
  updatePriceHistory
};

// ============================================================================
// CLI Support
// ============================================================================

if (require.main === module) {
  // CLI mode - can be called with sample data for testing
  console.log('Price Analyzer Module');
  console.log('=====================\n');
  console.log('Usage in code:');
  console.log('  const { analyzePrices } = require("./analyzer");');
  console.log('  const results = analyzePrices(currentData);');
  console.log('\nExported functions:');
  console.log('  - analyzePrices(currentData, options)');
  console.log('  - calculatePriceChange(oldPrice, newPrice)');
  console.log('  - generateMarkdownReport(results, metadata)');
  console.log('  - updatePriceHistory(currentData, options)');
}
