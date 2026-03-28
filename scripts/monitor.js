#!/usr/bin/env node
/**
 * Main Workflow Orchestrator
 * ==========================
 *
 * This script ties together all components of the price monitoring system:
 * 1. Loads competitor configuration
 * 2. Executes price extraction via scraper.js
 * 3. Analyzes results via analyzer.js
 * 4. Generates alerts for price changes
 * 5. Logs results appropriately
 *
 * Exit Codes:
 *   0 - Success (monitoring completed, changes may or may not be detected)
 *   1 - Failure (error occurred during execution)
 *
 * @module monitor
 * @version 1.0.0
 */

const fs = require('fs').promises;
const path = require('path');

// ============================================================================
// Import Dependencies
// ============================================================================

// Scraper module - Price Extraction Engine
const { extractPrices, loadConfig } = require('../workspace/scripts/scraper.js');

// Analyzer module - Comparison & Alert Engine
const { analyzePrices } = require('./analyzer.js');

// Data Store for state management
const dataStore = require('../utils/data-store.js');

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  // Directory paths
  LOGS_DIR: path.join(__dirname, '..', 'logs'),
  ALERTS_DIR: path.join(__dirname, '..', 'logs', 'alerts'),
  RUNS_DIR: path.join(__dirname, '..', 'logs', 'runs'),
  
  // Log files
  LAST_RUN_LOG: path.join(__dirname, '..', 'logs', 'runs', 'last-run.log'),
  
  // Alert configuration
  ALERT_FILE_FORMAT: 'YYYY-MM-DD_HH-mm-ss',
  
  // Execution configuration
  DEFAULT_CONCURRENT: 1,
  DEFAULT_HEADLESS: true,
  
  // Monitoring configuration
  EXIT_CODE_SUCCESS: 0,
  EXIT_CODE_FAILURE: 1,
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format timestamp for filename
 * @returns {string} Formatted timestamp (YYYY-MM-DD_HH-mm-ss)
 */
function formatTimestampForFilename() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

/**
 * Format timestamp for display
 * @returns {string} Formatted timestamp
 */
function formatTimestamp() {
  return new Date().toISOString();
}

/**
 * Ensure log directories exist
 */
async function ensureDirectories() {
  const dirs = [CONFIG.LOGS_DIR, CONFIG.ALERTS_DIR, CONFIG.RUNS_DIR];
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw new Error(`Failed to create directory ${dir}: ${error.message}`);
      }
    }
  }
}

/**
 * Transform scraper output to analyzer input format
 * @param {Array} scraperResults - Results from extractPrices()
 * @returns {Array} Formatted data for analyzer
 */
function transformScraperToAnalyzer(scraperResults) {
  return scraperResults
    .filter(result => result.success && result.price !== null)
    .map(result => ({
      product_id: result.product || 'unknown-product',
      competitor_name: result.competitor || 'unknown',
      price: result.price,
      currency: result.currency || 'USD',
      timestamp: result.timestamp || new Date().toISOString(),
      url: result.url,
      availability: result.availability || 'unknown'
    }));
}

/**
 * Write alert to file
 * @param {string} report - Markdown report content
 * @param {Object} summary - Change summary
 * @returns {string} Path to written file
 */
async function writeAlertFile(report, summary) {
  const filename = `${formatTimestampForFilename()}.md`;
  const filepath = path.join(CONFIG.ALERTS_DIR, filename);
  
  const content = `# Price Alert - ${formatTimestamp()}

## Summary
- New Products: ${summary.new_products}
- Removed Products: ${summary.removed_products}
- Price Drops: ${summary.price_drops}
- Price Increases: ${summary.price_increases}
- Stable Prices: ${summary.stable_prices}

---

${report}
`;
  
  await fs.writeFile(filepath, content, 'utf8');
  return filepath;
}

/**
 * Write to last-run log
 * @param {string} message - Log message
 * @param {string} level - Log level (INFO, WARN, ERROR, SUCCESS)
 */
async function writeLastRunLog(message, level = 'INFO') {
  const timestamp = formatTimestamp();
  const logEntry = `[${timestamp}] [${level}] ${message}\n`;
  
  try {
    await fs.appendFile(CONFIG.LAST_RUN_LOG, logEntry, 'utf8');
  } catch (error) {
    // Fallback to console if file write fails
    console.error(`Failed to write to log file: ${error.message}`);
    console.log(logEntry);
  }
}

/**
 * Clear/rotate last-run log if it gets too large (>1MB)
 */
async function rotateLogIfNeeded() {
  try {
    const stats = await fs.stat(CONFIG.LAST_RUN_LOG).catch(() => null);
    if (stats && stats.size > 1024 * 1024) {
      // Archive old log
      const archivePath = `${CONFIG.LAST_RUN_LOG}.${formatTimestampForFilename()}.old`;
      await fs.rename(CONFIG.LAST_RUN_LOG, archivePath);
      await writeLastRunLog('Log rotated - previous log archived', 'INFO');
    }
  } catch (error) {
    // Non-critical error, continue
    console.warn(`Warning: Could not rotate log: ${error.message}`);
  }
}

// ============================================================================
// Main Orchestration Logic
// ============================================================================

/**
 * Main monitoring execution function
 * @param {Object} options - Execution options
 * @returns {Promise<Object>} Execution results
 */
async function runMonitoring(options = {}) {
  const startTime = Date.now();
  const runId = dataStore.generateUUID();
  
  console.log('='.repeat(60));
  console.log('🔍 Price Monitoring System');
  console.log('='.repeat(60));
  console.log(`Run ID: ${runId}`);
  console.log(`Started: ${formatTimestamp()}`);
  console.log('');
  
  // Ensure directories exist
  await ensureDirectories();
  await rotateLogIfNeeded();
  
  // Update state - run started
  await dataStore.updateState({
    scraping_state: {
      current_session_id: runId,
      last_run: new Date().toISOString()
    }
  });
  
  await writeLastRunLog(`Monitoring run started (ID: ${runId})`, 'INFO');
  
  let extractionResults = [];
  let analysisResults = null;
  let alertFilePath = null;
  let hasChanges = false;
  
  try {
    // ========================================================================
    // STEP 1: Load Configuration
    // ========================================================================
    console.log('📋 Step 1: Loading competitor configuration...');
    const config = await loadConfig();
    const enabledCompetitors = Object.entries(config.competitors || {})
      .filter(([_, comp]) => comp.enabled)
      .map(([key, comp]) => ({ key, ...comp }));
    
    if (enabledCompetitors.length === 0) {
      throw new Error('No enabled competitors found in configuration');
    }
    
    console.log(`   Found ${enabledCompetitors.length} enabled competitor(s):`);
    enabledCompetitors.forEach(comp => {
      console.log(`   - ${comp.name} (${comp.key})`);
    });
    console.log('');
    
    // ========================================================================
    // STEP 2: Extract Prices
    // ========================================================================
    console.log('🔍 Step 2: Extracting current prices...');
    
    // Collect all URLs to scrape from enabled competitors
    const urlsToScrape = [];
    for (const competitor of enabledCompetitors) {
      // Check if competitor has target URLs defined
      if (competitor.target_urls && Array.isArray(competitor.target_urls)) {
        for (const url of competitor.target_urls) {
          urlsToScrape.push({ url, competitor: competitor.key });
        }
      }
    }
    
    // If no URLs configured, use example URLs for demonstration
    if (urlsToScrape.length === 0) {
      console.log('   ⚠️ No target URLs configured, using example URLs');
      console.log('   Add target_urls array to competitor config to monitor specific products');
      
      // Demo mode - would normally skip or error
      for (const competitor of enabledCompetitors.slice(0, 1)) {
        console.log(`   Demo: Would scrape ${competitor.name} (${competitor.base_url})`);
      }
      
      // Create mock results for demonstration
      extractionResults = enabledCompetitors.slice(0, 1).map(comp => ({
        competitor: comp.key,
        product: 'Demo Product',
        price: 99.99,
        currency: comp.currency?.code || 'USD',
        availability: 'in_stock',
        url: comp.base_url,
        timestamp: new Date().toISOString(),
        success: true,
        error: null,
        duration: 0,
        http_status: 200
      }));
      
      console.log('   Demo mode: Simulated extraction complete');
      console.log('');
    } else {
      // Real extraction
      console.log(`   Scraping ${urlsToScrape.length} URL(s)...`);
      
      for (const { url, competitor } of urlsToScrape) {
        try {
          const results = await extractPrices([url], competitor, {
            concurrent: options.concurrent || CONFIG.DEFAULT_CONCURRENT,
            headless: options.headless !== false ? CONFIG.DEFAULT_HEADLESS : false,
            delayBetweenRequests: 2000
          });
          extractionResults.push(...results);
        } catch (error) {
          console.error(`   ❌ Failed to scrape ${url}: ${error.message}`);
          extractionResults.push({
            competitor,
            product: null,
            price: null,
            currency: null,
            url,
            timestamp: new Date().toISOString(),
            success: false,
            error: error.message,
            error_type: 'EXTRACTION_FAILED'
          });
        }
      }
      
      console.log('');
    }
    
    const successfulExtractions = extractionResults.filter(r => r.success).length;
    console.log(`   ✅ Extraction complete: ${successfulExtractions}/${extractionResults.length} successful`);
    console.log('');
    
    await writeLastRunLog(
      `Price extraction complete: ${successfulExtractions}/${extractionResults.length} successful`,
      'INFO'
    );
    
    // ========================================================================
    // STEP 3: Analyze Prices
    // ========================================================================
    console.log('📊 Step 3: Analyzing prices...');
    
    // Transform scraper output to analyzer format
    const analyzerInput = transformScraperToAnalyzer(extractionResults);
    
    if (analyzerInput.length === 0) {
      console.log('   ⚠️ No valid price data to analyze');
      await writeLastRunLog('No valid price data to analyze', 'WARN');
    } else {
      console.log(`   Analyzing ${analyzerInput.length} price record(s)...`);
      
      // Run analysis
      analysisResults = analyzePrices(analyzerInput, {
        updateHistory: true,
        updateState: true,
        metadata: {
          run_id: runId,
          source: 'monitor-orchestrator'
        }
      });
      
      console.log('   ✅ Analysis complete');
      console.log('');
      
      // Check for changes
      hasChanges = analysisResults.summary.total_changes > 0;
      
      await writeLastRunLog(
        `Price analysis complete. Changes detected: ${hasChanges ? 'YES' : 'NO'} ` +
        `(new: ${analysisResults.summary.new_products}, ` +
        `drops: ${analysisResults.summary.price_drops}, ` +
        `increases: ${analysisResults.summary.price_increases})`,
        hasChanges ? 'SUCCESS' : 'INFO'
      );
    }
    
    // ========================================================================
    // STEP 4: Handle Results (Alert or Log)
    // ========================================================================
    console.log('📝 Step 4: Processing results...');
    
    if (hasChanges && analysisResults) {
      // Changes detected - write alert file
      console.log('   🔔 Changes detected! Generating alert...');
      
      alertFilePath = await writeAlertFile(
        analysisResults.report,
        analysisResults.summary
      );
      
      console.log(`   ✅ Alert written to: ${alertFilePath}`);
      console.log('');
      console.log('='.repeat(60));
      console.log('📊 PRICE CHANGE REPORT');
      console.log('='.repeat(60));
      console.log(analysisResults.report);
      console.log('='.repeat(60));
      
      await writeLastRunLog(`Alert generated: ${alertFilePath}`, 'SUCCESS');
      
    } else {
      // No changes - log to last-run.log
      console.log('   ✓ No price changes detected');
      console.log(`   Logged to: ${CONFIG.LAST_RUN_LOG}`);
      console.log('');
      
      await writeLastRunLog('No price changes detected', 'INFO');
    }
    
    // ========================================================================
    // STEP 5: Update State & Cleanup
    // ========================================================================
    const duration = Date.now() - startTime;
    
    await dataStore.recordScrapingRun({
      success: true,
      run_id: runId,
      duration_ms: duration,
      products_checked: extractionResults.length,
      successful_extractions: extractionResults.filter(r => r.success).length,
      changes_detected: hasChanges,
      alert_generated: !!alertFilePath,
      alert_file: alertFilePath
    });
    
    console.log('✅ Monitoring run completed successfully');
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Run ID: ${runId}`);
    console.log('='.repeat(60));
    
    await writeLastRunLog(
      `Monitoring run completed successfully in ${duration}ms`,
      'SUCCESS'
    );
    
    return {
      success: true,
      run_id: runId,
      duration,
      extraction_results: extractionResults,
      analysis_results: analysisResults,
      alert_file: alertFilePath,
      changes_detected: hasChanges
    };
    
  } catch (error) {
    // ========================================================================
    // ERROR HANDLING
    // ========================================================================
    const duration = Date.now() - startTime;
    
    console.error('');
    console.error('❌ MONITORING RUN FAILED');
    console.error('='.repeat(60));
    console.error(`Error: ${error.message}`);
    console.error(`Type: ${error.name || 'Unknown'}`);
    if (error.stack) {
      console.error(`Stack: ${error.stack.split('\n').slice(1, 3).join('\n')}`);
    }
    console.error('='.repeat(60));
    
    // Update state with failure
    try {
      await dataStore.recordScrapingRun({
        success: false,
        run_id: runId,
        duration_ms: duration,
        error: {
          message: error.message,
          code: error.code || 'UNKNOWN_ERROR',
          stack: error.stack
        }
      });
    } catch (stateError) {
      console.error(`Failed to record error state: ${stateError.message}`);
    }
    
    await writeLastRunLog(
      `Monitoring run FAILED: ${error.message}`,
      'ERROR'
    );
    
    // Re-throw for process exit handling
    throw error;
  }
}

// ============================================================================
// Global Error Handlers
// ============================================================================

/**
 * Handle uncaught exceptions
 */
process.on('uncaughtException', async (error) => {
  console.error('');
  console.error('💥 UNCAUGHT EXCEPTION');
  console.error(`Error: ${error.message}`);
  console.error('Stack:', error.stack);
  console.error('');
  
  try {
    await writeLastRunLog(`UNCAUGHT EXCEPTION: ${error.message}`, 'ERROR');
  } catch (logError) {
    console.error('Failed to log uncaught exception:', logError.message);
  }
  
  process.exit(CONFIG.EXIT_CODE_FAILURE);
});

/**
 * Handle unhandled promise rejections
 */
process.on('unhandledRejection', async (reason, promise) => {
  console.error('');
  console.error('💥 UNHANDLED PROMISE REJECTION');
  console.error('Reason:', reason);
  console.error('Promise:', promise);
  console.error('');
  
  try {
    const message = reason instanceof Error ? reason.message : String(reason);
    await writeLastRunLog(`UNHANDLED REJECTION: ${message}`, 'ERROR');
  } catch (logError) {
    console.error('Failed to log unhandled rejection:', logError.message);
  }
  
  process.exit(CONFIG.EXIT_CODE_FAILURE);
});

/**
 * Handle process signals for graceful shutdown
 */
process.on('SIGINT', async () => {
  console.log('\n\n⚠️ Received SIGINT, shutting down gracefully...');
  await writeLastRunLog('Monitoring interrupted by SIGINT', 'WARN');
  process.exit(CONFIG.EXIT_CODE_FAILURE);
});

process.on('SIGTERM', async () => {
  console.log('\n\n⚠️ Received SIGTERM, shutting down gracefully...');
  await writeLastRunLog('Monitoring interrupted by SIGTERM', 'WARN');
  process.exit(CONFIG.EXIT_CODE_FAILURE);
});

// ============================================================================
// CLI Interface
// ============================================================================

/**
 * Print usage information
 */
function printUsage() {
  console.log(`
Price Monitoring System - Main Orchestrator
===========================================

Usage:
  node monitor.js [options]

Options:
  --concurrent <n>    Number of concurrent scrapes (default: 1)
  --headful           Run browser in visible mode (for debugging)
  --demo              Run in demo mode (no actual scraping)
  --help              Show this help message

Examples:
  node monitor.js                              # Standard run
  node monitor.js --concurrent 2               # Run 2 concurrent scrapes
  node monitor.js --headful                    # Debug mode with visible browser
  node monitor.js --demo                       # Demo mode (simulated data)

Exit Codes:
  0 - Success (monitoring completed)
  1 - Failure (error occurred)
`);
}

/**
 * Parse command line arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    concurrent: 1,
    headless: true,
    demo: false
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help':
      case '-h':
        printUsage();
        process.exit(CONFIG.EXIT_CODE_SUCCESS);
        break;
        
      case '--concurrent':
      case '-c':
        options.concurrent = parseInt(args[++i]) || 1;
        break;
        
      case '--headful':
        options.headless = false;
        break;
        
      case '--demo':
        options.demo = true;
        break;
        
      default:
        console.warn(`Unknown option: ${args[i]}`);
        break;
    }
  }
  
  return options;
}

// ============================================================================
// Entry Point
// ============================================================================

async function main() {
  const options = parseArguments();
  
  console.log('Starting Price Monitoring System...');
  console.log(`Options: ${JSON.stringify(options)}`);
  console.log('');
  
  try {
    const results = await runMonitoring(options);
    
    // Exit with success code
    process.exit(CONFIG.EXIT_CODE_SUCCESS);
    
  } catch (error) {
    console.error('');
    console.error('Monitoring run failed with error:', error.message);
    
    // Exit with failure code
    process.exit(CONFIG.EXIT_CODE_FAILURE);
  }
}

// Run main if called directly
if (require.main === module) {
  main();
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  runMonitoring,
  transformScraperToAnalyzer,
  writeAlertFile,
  writeLastRunLog,
  formatTimestamp,
  formatTimestampForFilename,
  CONFIG
};
