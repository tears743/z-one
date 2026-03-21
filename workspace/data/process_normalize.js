const fs = require('fs');
const path = require('path');

// Configuration
const RAW_DATA_DIR = 'data/raw';
const PROCESSED_DIR = 'data/processed';
const USD_CNY_RATE = 7.2345; // From SHFE data
const GRAMS_PER_TROY_OUNCE = 31.1034768;

// Helper: Parse various timestamp formats to ISO 8601
function normalizeTimestamp(ts, exchange) {
  try {
    if (exchange === 'CME') {
      // Format: "03/17/2025 14:30:00 CST"
      const [datePart, timePart, tz] = ts.split(' ');
      const [month, day, year] = datePart.split('/');
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart}-06:00`;
    } else if (exchange === 'COMEX') {
      // Format: "2025-03-17T20:30:00Z" (already ISO)
      return ts;
    } else if (exchange === 'SHFE') {
      // Format: "2025-03-17 15:00:00"
      return `${ts.replace(' ', 'T')}+08:00`;
    }
  } catch (e) {
    console.warn(`Failed to parse timestamp: ${ts}`);
    return ts;
  }
}

// Helper: Convert CNY/gram to USD/troy ounce
function convertCNYperGramToUSDperOz(cnyPerGram) {
  const usdPerGram = cnyPerGram / USD_CNY_RATE;
  const usdPerOz = usdPerGram * GRAMS_PER_TROY_OUNCE;
  return Math.round(usdPerOz * 100) / 100;
}

// Helper: Normalize contract month to standard format
function normalizeContractMonth(monthStr) {
  const monthMap = {
    'January': '01', 'February': '02', 'March': '03', 'April': '04',
    'May': '05', 'June': '06', 'July': '07', 'August': '08',
    'September': '09', 'October': '10', 'November': '11', 'December': '12'
  };
  
  // Handle "April 2025" format
  for (const [name, num] of Object.entries(monthMap)) {
    if (monthStr.includes(name)) {
      const year = monthStr.match(/\d{4}/)?.[0];
      return year ? `${year}-${num}` : monthStr;
    }
  }
  
  // Handle "2025年4月" format (Chinese)
  const chineseMatch = monthStr.match(/(\d{4})年(\d{1,2})月/);
  if (chineseMatch) {
    return `${chineseMatch[1]}-${chineseMatch[2].padStart(2, '0')}`;
  }
  
  // Handle "2025-04" format
  if (/^\d{4}-\d{2}$/.test(monthStr)) {
    return monthStr;
  }
  
  return monthStr;
}

// Load and normalize CME data
function processCMEData(rawData) {
  return rawData.data.map(item => ({
    exchange: 'CME',
    exchange_code: 'CME',
    location: 'Chicago',
    symbol: item.symbol,
    contract_month: normalizeContractMonth(item.contract_month),
    last_trade_date: item.last_trade_date,
    timestamp: normalizeTimestamp(item.timestamp, 'CME'),
    price_currency: 'USD',
    price_unit: 'per_troy_ounce',
    open_price: item.open,
    high_price: item.high,
    low_price: item.low,
    close_price: item.last,
    settlement_price: item.settle,
    volume: item.volume,
    open_interest: item.open_interest,
    contract_size: rawData.metadata.contract_size,
    tick_size: rawData.metadata.tick_size,
    conversion_applied: false,
    conversion_rate: 1.0,
    original_currency: 'USD'
  }));
}

// Load and normalize COMEX data
function processCOMEXData(rawData) {
  return rawData.quotes.map(item => ({
    exchange: 'COMEX',
    exchange_code: 'COMEX',
    location: 'New York',
    symbol: item.contract_code,
    contract_month: normalizeContractMonth(item.maturity),
    last_trade_date: null, // Not provided in raw data
    timestamp: normalizeTimestamp(item.trade_timestamp, 'COMEX'),
    price_currency: 'USD',
    price_unit: 'per_troy_ounce',
    open_price: item.ohlc.o,
    high_price: item.ohlc.h,
    low_price: item.ohlc.l,
    close_price: item.ohlc.c,
    settlement_price: item.settlement_price,
    volume: item.vol,
    open_interest: item.oi,
    contract_size: rawData.specs.contract_multiplier,
    tick_size: rawData.specs.min_fluctuation,
    conversion_applied: false,
    conversion_rate: 1.0,
    original_currency: 'USD'
  }));
}

// Load and normalize SHFE data
function processSHFEData(rawData) {
  const conversionRate = rawData['汇率参考'].USDCNY;
  
  return rawData['合约信息'].map(item => ({
    exchange: 'SHFE',
    exchange_code: 'SHFE',
    location: 'Shanghai',
    symbol: item['合约代码'],
    contract_month: normalizeContractMonth(item['合约月份']),
    last_trade_date: item['交割日期'],
    timestamp: normalizeTimestamp(item['交易时间'], 'SHFE'),
    price_currency: 'USD',
    price_unit: 'per_troy_ounce',
    open_price: convertCNYperGramToUSDperOz(item['开盘价']),
    high_price: convertCNYperGramToUSDperOz(item['最高价']),
    low_price: convertCNYperGramToUSDperOz(item['最低价']),
    close_price: convertCNYperGramToUSDperOz(item['收盘价']),
    settlement_price: convertCNYperGramToUSDperOz(item['结算价']),
    volume: item['成交量'],
    open_interest: item['持仓量'],
    contract_size: rawData['合约规格']['每手数量'], // 1000g per contract
    tick_size: rawData['合约规格']['最小变动价位'],
    conversion_applied: true,
    conversion_rate: conversionRate,
    original_currency: 'CNY',
    original_unit: 'per_gram'
  }));
}

// Data validation checks
function validateData(consolidatedData) {
  const issues = [];
  
  // Check for required fields
  const requiredFields = [
    'exchange', 'symbol', 'contract_month', 'timestamp', 
    'open_price', 'high_price', 'low_price', 'close_price'
  ];
  
  for (const record of consolidatedData) {
    for (const field of requiredFields) {
      if (record[field] === undefined || record[field] === null) {
        issues.push(`Missing ${field} for ${record.symbol}`);
      }
    }
    
    // Check price logic (high >= low, etc.)
    if (record.high_price < record.low_price) {
      issues.push(`Price logic error: high < low for ${record.symbol}`);
    }
    if (record.open_price < 0 || record.close_price < 0) {
      issues.push(`Negative price for ${record.symbol}`);
    }
    
    // Check timestamp validity
    const ts = new Date(record.timestamp);
    if (isNaN(ts.getTime())) {
      issues.push(`Invalid timestamp for ${record.symbol}: ${record.timestamp}`);
    }
  }
  
  // Check for duplicate symbols
  const symbols = consolidatedData.map(r => r.symbol);
  const duplicates = symbols.filter((item, index) => symbols.indexOf(item) !== index);
  if (duplicates.length > 0) {
    issues.push(`Duplicate symbols found: ${[...new Set(duplicates)].join(', ')}`);
  }
  
  return issues;
}

// Convert to CSV
function convertToCSV(data) {
  if (data.length === 0) return '';
  
  const headers = Object.keys(data[0]);
  const csvRows = [headers.join(',')];
  
  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];
      // Escape values with commas or quotes
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    csvRows.push(values.join(','));
  }
  
  return csvRows.join('\n');
}

// Main processing
console.log('=== GOLD FUTURES DATA NORMALIZATION & AGGREGATION ===\n');

// Read raw files
console.log('Reading raw data files...');
const cmeRaw = JSON.parse(fs.readFileSync(path.join(RAW_DATA_DIR, 'cme_gold.json'), 'utf8'));
const comexRaw = JSON.parse(fs.readFileSync(path.join(RAW_DATA_DIR, 'comex_gold.json'), 'utf8'));
const shfeRaw = JSON.parse(fs.readFileSync(path.join(RAW_DATA_DIR, 'shfe_gold.json'), 'utf8'));

console.log('✓ Loaded CME data:', cmeRaw.data.length, 'records');
console.log('✓ Loaded COMEX data:', comexRaw.quotes.length, 'records');
console.log('✓ Loaded SHFE data:', shfeRaw['合约信息'].length, 'records');

// Process each dataset
console.log('\nNormalizing schemas...');
const cmeNormalized = processCMEData(cmeRaw);
const comexNormalized = processCOMEXData(comexRaw);
const shfeNormalized = processSHFEData(shfeRaw);

console.log('✓ CME normalized:', cmeNormalized.length, 'records');
console.log('✓ COMEX normalized:', comexNormalized.length, 'records');
console.log('✓ SHFE normalized (CNY/gram→USD/oz converted):', shfeNormalized.length, 'records');

// Aggregate
console.log('\nAggregating datasets...');
const consolidated = [...cmeNormalized, ...comexNormalized, ...shfeNormalized];
console.log('✓ Total consolidated records:', consolidated.length);

// Validation
console.log('\nPerforming data validation checks...');
const issues = validateData(consolidated);
if (issues.length === 0) {
  console.log('✓ All validation checks passed');
} else {
  console.warn('⚠ Validation issues found:');
  issues.forEach(issue => console.warn('  -', issue));
}

// Create summary statistics
const summary = {
  processing_timestamp: new Date().toISOString(),
  total_records: consolidated.length,
  exchanges: [...new Set(consolidated.map(r => r.exchange))],
  contract_months: [...new Set(consolidated.map(r => r.contract_month))].sort(),
  price_range: {
    min: Math.min(...consolidated.map(r => r.low_price)),
    max: Math.max(...consolidated.map(r => r.high_price))
  },
  total_volume: consolidated.reduce((sum, r) => sum + r.volume, 0),
  total_open_interest: consolidated.reduce((sum, r) => sum + r.open_interest, 0),
  currency_conversions: consolidated.filter(r => r.conversion_applied).length,
  validation_issues: issues.length
};

const outputData = {
  metadata: {
    description: 'Consolidated Gold Futures Data - Normalized & Aggregated',
    source_exchanges: ['CME', 'COMEX', 'SHFE'],
    processing_date: new Date().toISOString().split('T')[0],
    price_currency: 'USD',
    price_unit: 'per_troy_ounce',
    usd_cny_rate_used: USD_CNY_RATE,
    grams_per_troy_ounce: GRAMS_PER_TROY_OUNCE,
    summary: summary
  },
  data: consolidated
};

// Ensure output directory exists
if (!fs.existsSync(PROCESSED_DIR)) {
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
}

// Save JSON
const jsonPath = path.join(PROCESSED_DIR, 'gold_futures_consolidated.json');
fs.writeFileSync(jsonPath, JSON.stringify(outputData, null, 2));
console.log('\n✓ Saved JSON output to:', jsonPath);

// Save CSV
const csvPath = path.join(PROCESSED_DIR, 'gold_futures_consolidated.csv');
fs.writeFileSync(csvPath, convertToCSV(consolidated));
console.log('✓ Saved CSV output to:', csvPath);

// Print summary
console.log('\n=== PROCESSING SUMMARY ===');
console.log(`Total Records: ${summary.total_records}`);
console.log(`Exchanges: ${summary.exchanges.join(', ')}`);
console.log(`Contract Months: ${summary.contract_months.join(', ')}`);
console.log(`Price Range: $${summary.price_range.min.toFixed(2)} - $${summary.price_range.max.toFixed(2)} USD/oz`);
console.log(`Total Volume: ${summary.total_volume.toLocaleString()}`);
console.log(`Total Open Interest: ${summary.total_open_interest.toLocaleString()}`);
console.log(`Currency Conversions: ${summary.currency_conversions} records`);
console.log(`Validation Issues: ${summary.validation_issues}`);
console.log('\nProcessing complete!');
