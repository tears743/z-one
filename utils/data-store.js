/**
 * Data Store Utility Module
 * 
 * Provides atomic read/write operations for price history and state management
 * with automatic backup creation and data integrity validation.
 * 
 * @module data-store
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  DATA_DIR: path.join(__dirname, '..', 'data'),
  BACKUP_DIR: path.join(__dirname, '..', 'data', 'backups'),
  PRICE_HISTORY_FILE: 'price_history.json',
  STATE_FILE: 'state.json',
  MAX_BACKUPS: 10,
  ATOMIC_WRITE_TEMP_SUFFIX: '.tmp',
  BACKUP_TIMESTAMP_FORMAT: 'YYYYMMDD-HHmmss',
  DEFAULT_ENCODING: 'utf8'
};

// ============================================================================
// Error Classes
// ============================================================================

class DataStoreError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'DataStoreError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

class ValidationError extends DataStoreError {
  constructor(message, details) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

class FileOperationError extends DataStoreError {
  constructor(message, details) {
    super(message, 'FILE_OPERATION_ERROR', details);
    this.name = 'FileOperationError';
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a UUID v4
 * @returns {string} UUID string
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Format timestamp for backup filenames
 * @returns {string} Formatted timestamp
 */
function formatBackupTimestamp() {
  const now = new Date();
  return now.toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
}

/**
 * Ensure directory exists
 * @param {string} dirPath - Directory path
 * @throws {FileOperationError} If directory cannot be created
 */
function ensureDirectory(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (error) {
    throw new FileOperationError(
      `Failed to create directory: ${dirPath}`,
      { path: dirPath, originalError: error.message }
    );
  }
}

/**
 * Calculate file checksum for integrity verification
 * @param {string} content - File content
 * @returns {string} SHA-256 hash
 */
function calculateChecksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

// ============================================================================
// Validation Functions
// ============================================================================

const VALID_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CNY', 'INR', 'MXN', 'BRL'];
const VALID_STATUSES = ['available', 'out_of_stock', 'discontinued', 'price_on_request', 'unknown'];

/**
 * Validate a price record against schema
 * @param {Object} record - Price record to validate
 * @throws {ValidationError} If validation fails
 */
function validatePriceRecord(record) {
  const errors = [];

  // Required fields
  if (!record.product_id || typeof record.product_id !== 'string' || record.product_id.length === 0) {
    errors.push('product_id is required and must be a non-empty string');
  }

  if (!record.competitor_name || typeof record.competitor_name !== 'string' || record.competitor_name.length === 0) {
    errors.push('competitor_name is required and must be a non-empty string');
  }

  if (typeof record.price !== 'number' || record.price < 0 || record.price >= 10000000) {
    errors.push('price is required and must be a number between 0 and 10,000,000');
  }

  if (!record.currency || !VALID_CURRENCIES.includes(record.currency)) {
    errors.push(`currency is required and must be one of: ${VALID_CURRENCIES.join(', ')}`);
  }

  if (!record.timestamp || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/.test(record.timestamp)) {
    errors.push('timestamp is required and must be in ISO 8601 format');
  }

  // Optional field validations
  if (record.url && (typeof record.url !== 'string' || record.url.length > 2048)) {
    errors.push('url must be a string with maximum length of 2048');
  }

  if (record.status && !VALID_STATUSES.includes(record.status)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  if (errors.length > 0) {
    throw new ValidationError('Price record validation failed', { errors, record });
  }
}

/**
 * Validate state object structure
 * @param {Object} state - State object to validate
 * @throws {ValidationError} If validation fails
 */
function validateState(state) {
  const errors = [];

  if (!state || typeof state !== 'object') {
    errors.push('State must be an object');
  } else {
    if (state.application_state && typeof state.application_state !== 'object') {
      errors.push('application_state must be an object');
    }
    if (state.scraping_state && typeof state.scraping_state !== 'object') {
      errors.push('scraping_state must be an object');
    }
  }

  if (errors.length > 0) {
    throw new ValidationError('State validation failed', { errors });
  }
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Read JSON file with error handling
 * @param {string} filePath - Path to file
 * @returns {Object} Parsed JSON content
 * @throws {FileOperationError} If read or parse fails
 */
function readJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, CONFIG.DEFAULT_ENCODING);
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new FileOperationError(`File not found: ${filePath}`, { path: filePath });
    }
    if (error instanceof SyntaxError) {
      throw new FileOperationError(`Invalid JSON in file: ${filePath}`, { 
        path: filePath, 
        originalError: error.message 
      });
    }
    throw new FileOperationError(`Failed to read file: ${filePath}`, { 
      path: filePath, 
      originalError: error.message 
    });
  }
}

/**
 * Atomic write operation with backup
 * @param {string} filePath - Target file path
 * @param {Object} data - Data to write
 * @param {boolean} createBackup - Whether to create backup before write
 * @returns {Object} Write result with checksum
 * @throws {FileOperationError} If write fails
 */
function atomicWrite(filePath, data, createBackup = true) {
  const tempPath = `${filePath}${CONFIG.ATOMIC_WRITE_TEMP_SUFFIX}`;
  const backupPath = createBackup ? 
    `${filePath}.backup-${formatBackupTimestamp()}` : null;

  try {
    // Create backup if requested and file exists
    if (createBackup && fs.existsSync(filePath)) {
      ensureDirectory(CONFIG.BACKUP_DIR);
      const backupFileName = `${path.basename(filePath)}.backup-${formatBackupTimestamp()}.json`;
      const backupFullPath = path.join(CONFIG.BACKUP_DIR, backupFileName);
      fs.copyFileSync(filePath, backupFullPath);
      cleanupOldBackups(path.basename(filePath));
    }

    // Serialize data
    const content = JSON.stringify(data, null, 2);
    const checksum = calculateChecksum(content);

    // Write to temp file first (atomic operation)
    fs.writeFileSync(tempPath, content, CONFIG.DEFAULT_ENCODING);

    // Verify temp file was written correctly
    const tempContent = fs.readFileSync(tempPath, CONFIG.DEFAULT_ENCODING);
    if (calculateChecksum(tempContent) !== checksum) {
      throw new Error('Checksum mismatch after writing temp file');
    }

    // Atomic rename
    fs.renameSync(tempPath, filePath);

    return {
      success: true,
      checksum,
      bytesWritten: Buffer.byteLength(content, 'utf8'),
      backupCreated: !!backupPath,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    // Cleanup temp file on failure
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
    throw new FileOperationError(
      `Failed to write file atomically: ${filePath}`,
      { path: filePath, originalError: error.message }
    );
  }
}

/**
 * Clean up old backups, keeping only MAX_BACKUPS most recent
 * @param {string} baseFileName - Base filename pattern to match
 */
function cleanupOldBackups(baseFileName) {
  try {
    if (!fs.existsSync(CONFIG.BACKUP_DIR)) return;

    const backups = fs.readdirSync(CONFIG.BACKUP_DIR)
      .filter(file => file.startsWith(baseFileName) && file.includes('.backup-'))
      .map(file => ({
        name: file,
        path: path.join(CONFIG.BACKUP_DIR, file),
        time: fs.statSync(path.join(CONFIG.BACKUP_DIR, file)).mtime
      }))
      .sort((a, b) => b.time - a.time);

    // Remove excess backups
    if (backups.length > CONFIG.MAX_BACKUPS) {
      backups.slice(CONFIG.MAX_BACKUPS).forEach(backup => {
        try {
          fs.unlinkSync(backup.path);
        } catch (error) {
          console.warn(`Failed to remove old backup: ${backup.name}`);
        }
      });
    }
  } catch (error) {
    // Non-critical error, just log
    console.warn('Failed to cleanup old backups:', error.message);
  }
}

// ============================================================================
// Price History Operations
// ============================================================================

const priceHistoryPath = path.join(CONFIG.DATA_DIR, CONFIG.PRICE_HISTORY_FILE);

/**
 * Initialize price history file if it doesn't exist
 * @returns {boolean} True if initialization was performed
 */
function initPriceHistory() {
  ensureDirectory(CONFIG.DATA_DIR);
  
  if (!fs.existsSync(priceHistoryPath)) {
    const initialData = {
      schema_version: "1.0.0",
      description: "Price tracking history for competitor products",
      created_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      records: [],
      schema: {},
      indexes: {},
      constraints: {}
    };
    atomicWrite(priceHistoryPath, initialData, false);
    return true;
  }
  return false;
}

/**
 * Read all price history records
 * @returns {Object} Price history data
 * @throws {FileOperationError} If read fails
 */
function readPriceHistory() {
  initPriceHistory();
  return readJsonFile(priceHistoryPath);
}

/**
 * Add a new price record
 * @param {Object} record - Price record to add
 * @param {Object} options - Options for the operation
 * @param {boolean} options.validate - Whether to validate the record (default: true)
 * @param {boolean} options.atomic - Whether to use atomic write (default: true)
 * @returns {Object} Result with record_id and operation details
 * @throws {ValidationError|FileOperationError} If validation or write fails
 */
function addPriceRecord(record, options = {}) {
  const { validate = true, atomic = true } = options;

  // Validate if requested
  if (validate) {
    validatePriceRecord(record);
  }

  // Enrich record with metadata
  const enrichedRecord = {
    record_id: generateUUID(),
    ...record,
    status: record.status || 'available',
    timestamp: record.timestamp || new Date().toISOString(),
    _ingested_at: new Date().toISOString()
  };

  // Read current data
  const data = readPriceHistory();
  
  // Add record
  data.records.push(enrichedRecord);
  data.last_updated = new Date().toISOString();
  data.record_count = data.records.length;

  // Write atomically
  const writeResult = atomicWrite(priceHistoryPath, data, atomic);

  return {
    success: true,
    record_id: enrichedRecord.record_id,
    operation: 'add',
    timestamp: new Date().toISOString(),
    ...writeResult
  };
}

/**
 * Add multiple price records in a batch
 * @param {Array<Object>} records - Array of price records
 * @param {Object} options - Options for the operation
 * @returns {Object} Batch operation result
 */
function addPriceRecordsBatch(records, options = {}) {
  if (!Array.isArray(records)) {
    throw new ValidationError('Records must be an array', { received: typeof records });
  }

  const results = {
    success: true,
    total: records.length,
    added: 0,
    failed: 0,
    errors: [],
    record_ids: []
  };

  // Validate all records first (fail fast)
  records.forEach((record, index) => {
    try {
      validatePriceRecord(record);
    } catch (error) {
      results.errors.push({ index, error: error.message, details: error.details });
      results.failed++;
    }
  });

  if (results.failed > 0 && options.failFast !== false) {
    results.success = false;
    return results;
  }

  // Read current data once
  const data = readPriceHistory();
  const enrichedRecords = [];

  records.forEach((record, index) => {
    if (results.errors.find(e => e.index === index)) return;

    const enrichedRecord = {
      record_id: generateUUID(),
      ...record,
      status: record.status || 'available',
      timestamp: record.timestamp || new Date().toISOString(),
      _ingested_at: new Date().toISOString()
    };

    enrichedRecords.push(enrichedRecord);
    results.record_ids.push(enrichedRecord.record_id);
    results.added++;
  });

  // Batch update
  data.records.push(...enrichedRecords);
  data.last_updated = new Date().toISOString();
  data.record_count = data.records.length;

  const writeResult = atomicWrite(priceHistoryPath, data, options.atomic !== false);

  return {
    ...results,
    ...writeResult,
    operation: 'batch_add'
  };
}

/**
 * Query price records with filters
 * @param {Object} filters - Query filters
 * @param {string} filters.product_id - Filter by product ID
 * @param {string} filters.competitor_name - Filter by competitor name
 * @param {string} filters.start_date - Start date (ISO 8601)
 * @param {string} filters.end_date - End date (ISO 8601)
 * @param {string} filters.status - Filter by status
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum records to return
 * @param {number} options.offset - Offset for pagination
 * @param {string} options.sort_by - Field to sort by
 * @param {boolean} options.sort_desc - Sort descending
 * @returns {Object} Query results
 */
function queryPriceRecords(filters = {}, options = {}) {
  const data = readPriceHistory();
  let records = [...data.records];

  // Apply filters
  if (filters.product_id) {
    records = records.filter(r => r.product_id === filters.product_id);
  }
  if (filters.competitor_name) {
    records = records.filter(r => r.competitor_name === filters.competitor_name);
  }
  if (filters.status) {
    records = records.filter(r => r.status === filters.status);
  }
  if (filters.start_date) {
    const start = new Date(filters.start_date);
    records = records.filter(r => new Date(r.timestamp) >= start);
  }
  if (filters.end_date) {
    const end = new Date(filters.end_date);
    records = records.filter(r => new Date(r.timestamp) <= end);
  }

  // Sorting
  const sortField = options.sort_by || 'timestamp';
  const sortDesc = options.sort_desc !== false;
  records.sort((a, b) => {
    const aVal = a[sortField] || '';
    const bVal = b[sortField] || '';
    const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return sortDesc ? -comparison : comparison;
  });

  // Pagination
  const total = records.length;
  const offset = options.offset || 0;
  const limit = options.limit || 100;
  records = records.slice(offset, offset + limit);

  return {
    records,
    total,
    offset,
    limit,
    has_more: total > offset + limit
  };
}

/**
 * Get price statistics for a product
 * @param {string} product_id - Product ID
 * @param {Object} options - Options
 * @returns {Object} Price statistics
 */
function getPriceStats(product_id, options = {}) {
  const query = queryPriceRecords({ product_id }, { limit: 10000, sort_by: 'timestamp' });
  const records = query.records;

  if (records.length === 0) {
    return { product_id, record_count: 0 };
  }

  const prices = records.map(r => r.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

  // Calculate price changes
  const changes = [];
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1];
    const curr = records[i];
    const change = curr.price - prev.price;
    const percentChange = (change / prev.price) * 100;
    changes.push({
      from: prev.timestamp,
      to: curr.timestamp,
      change: parseFloat(change.toFixed(2)),
      percent_change: parseFloat(percentChange.toFixed(2))
    });
  }

  return {
    product_id,
    record_count: records.length,
    price_range: { min, max, avg: parseFloat(avg.toFixed(2)) },
    first_seen: records[0].timestamp,
    last_seen: records[records.length - 1].timestamp,
    price_changes: options.include_changes !== false ? changes : undefined,
    latest_price: records[records.length - 1].price,
    latest_currency: records[records.length - 1].currency
  };
}

// ============================================================================
// State Operations
// ============================================================================

const statePath = path.join(CONFIG.DATA_DIR, CONFIG.STATE_FILE);

/**
 * Initialize state file if it doesn't exist
 * @returns {boolean} True if initialization was performed
 */
function initState() {
  ensureDirectory(CONFIG.DATA_DIR);
  
  if (!fs.existsSync(statePath)) {
    const initialState = {
      schema_version: "1.0.0",
      description: "State tracking for price monitoring application",
      last_updated: new Date().toISOString(),
      application_state: {
        status: "initialized",
        startup_count: 0,
        first_run: new Date().toISOString()
      },
      scraping_state: {
        last_run: null,
        last_successful_run: null,
        last_failed_run: null,
        total_runs: 0,
        successful_runs: 0,
        failed_runs: 0,
        consecutive_failures: 0,
        last_error: null,
        current_session_id: null,
        active_jobs: []
      },
      data_state: {
        last_record_count: 0,
        last_archive_date: null,
        pending_backups: [],
        storage_size_bytes: 0
      },
      scheduling: {
        next_scheduled_run: null,
        cron_expression: null,
        timezone: "UTC",
        enabled: false
      }
    };
    atomicWrite(statePath, initialState, false);
    return true;
  }
  return false;
}

/**
 * Read current state
 * @returns {Object} State object
 */
function readState() {
  initState();
  return readJsonFile(statePath);
}

/**
 * Update state with new values
 * @param {Object} updates - State updates (deep merge)
 * @param {Object} options - Update options
 * @returns {Object} Update result
 */
function updateState(updates, options = {}) {
  if (!updates || typeof updates !== 'object') {
    throw new ValidationError('Updates must be an object', { received: typeof updates });
  }

  const currentState = readState();
  
  // Deep merge helper
  function deepMerge(target, source) {
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        target[key] = target[key] || {};
        deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  }

  // Merge updates
  const newState = deepMerge({ ...currentState }, updates);
  newState.last_updated = new Date().toISOString();

  validateState(newState);

  const writeResult = atomicWrite(statePath, newState, options.atomic !== false);

  return {
    success: true,
    operation: 'update_state',
    timestamp: new Date().toISOString(),
    ...writeResult
  };
}

/**
 * Record a scraping run in state
 * @param {Object} runData - Run data
 * @returns {Object} Update result
 */
function recordScrapingRun(runData) {
  const state = readState();
  const session_id = generateUUID();
  const now = new Date().toISOString();

  const updates = {
    scraping_state: {
      last_run: now,
      total_runs: (state.scraping_state?.total_runs || 0) + 1,
      current_session_id: session_id
    }
  };

  if (runData.success) {
    updates.scraping_state.last_successful_run = now;
    updates.scraping_state.successful_runs = (state.scraping_state?.successful_runs || 0) + 1;
    updates.scraping_state.consecutive_failures = 0;
  } else {
    updates.scraping_state.last_failed_run = now;
    updates.scraping_state.failed_runs = (state.scraping_state?.failed_runs || 0) + 1;
    updates.scraping_state.consecutive_failures = (state.scraping_state?.consecutive_failures || 0) + 1;
    updates.scraping_state.last_error = {
      timestamp: now,
      message: runData.error?.message || 'Unknown error',
      code: runData.error?.code || 'UNKNOWN'
    };
  }

  // Add to run history (keep last 100)
  if (!state.run_history) state.run_history = [];
  state.run_history.unshift({
    session_id,
    timestamp: now,
    ...runData
  });
  if (state.run_history.length > 100) {
    state.run_history = state.run_history.slice(0, 100);
  }
  updates.run_history = state.run_history;

  return updateState(updates);
}

// ============================================================================
// Backup and Recovery
// ============================================================================

/**
 * List available backups
 * @param {string} fileType - Type of file ('price_history' or 'state')
 * @returns {Array<Object>} List of backups
 */
function listBackups(fileType = null) {
  if (!fs.existsSync(CONFIG.BACKUP_DIR)) {
    return [];
  }

  const files = fs.readdirSync(CONFIG.BACKUP_DIR)
    .filter(file => file.endsWith('.json'))
    .map(file => {
      const filePath = path.join(CONFIG.BACKUP_DIR, file);
      const stats = fs.statSync(filePath);
      const match = file.match(/^(.+)\.backup-(.+)\.json$/);
      return {
        filename: file,
        original_file: match ? match[1] : file,
        timestamp: match ? match[2].replace('_', 'T').replace(/-/g, ':') : null,
        size_bytes: stats.size,
        created: stats.mtime.toISOString(),
        path: filePath
      };
    });

  if (fileType) {
    return files.filter(f => f.original_file === `${fileType}.json`);
  }

  return files.sort((a, b) => new Date(b.created) - new Date(a.created));
}

/**
 * Restore from backup
 * @param {string} backupFilename - Backup filename to restore
 * @param {boolean} createBackup - Whether to backup current before restore
 * @returns {Object} Restore result
 */
function restoreFromBackup(backupFilename, createBackup = true) {
  const backupPath = path.join(CONFIG.BACKUP_DIR, backupFilename);
  
  if (!fs.existsSync(backupPath)) {
    throw new FileOperationError(`Backup not found: ${backupFilename}`, { filename: backupFilename });
  }

  const match = backupFilename.match(/^(.+)\.backup-(.+)\.json$/);
  if (!match) {
    throw new ValidationError('Invalid backup filename format', { filename: backupFilename });
  }

  const targetFile = `${match[1]}.json`;
  const targetPath = path.join(CONFIG.DATA_DIR, targetFile);

  // Backup current if requested
  if (createBackup && fs.existsSync(targetPath)) {
    atomicWrite(targetPath, readJsonFile(targetPath), true);
  }

  // Copy backup to target
  fs.copyFileSync(backupPath, targetPath);

  return {
    success: true,
    restored_from: backupFilename,
    target_file: targetFile,
    timestamp: new Date().toISOString()
  };
}

/**
 * Create manual backup of current data files
 * @param {string} fileType - Type to backup ('price_history', 'state', or 'all')
 * @returns {Object} Backup result
 */
function createManualBackup(fileType = 'all') {
  const filesToBackup = [];
  
  if (fileType === 'all' || fileType === 'price_history') {
    filesToBackup.push(CONFIG.PRICE_HISTORY_FILE);
  }
  if (fileType === 'all' || fileType === 'state') {
    filesToBackup.push(CONFIG.STATE_FILE);
  }

  const results = [];
  ensureDirectory(CONFIG.BACKUP_DIR);

  for (const file of filesToBackup) {
    const filePath = path.join(CONFIG.DATA_DIR, file);
    if (fs.existsSync(filePath)) {
      const backupFileName = `${file}.manual-${formatBackupTimestamp()}.json`;
      const backupPath = path.join(CONFIG.BACKUP_DIR, backupFileName);
      fs.copyFileSync(filePath, backupPath);
      results.push({ file, backup: backupFileName });
    }
  }

  return {
    success: true,
    backups_created: results,
    timestamp: new Date().toISOString()
  };
}

// ============================================================================
// Export Module
// ============================================================================

module.exports = {
  // Error classes
  DataStoreError,
  ValidationError,
  FileOperationError,

  // Configuration
  CONFIG,

  // Price history operations
  initPriceHistory,
  readPriceHistory,
  addPriceRecord,
  addPriceRecordsBatch,
  queryPriceRecords,
  getPriceStats,
  validatePriceRecord,

  // State operations
  initState,
  readState,
  updateState,
  recordScrapingRun,
  validateState,

  // Backup and recovery
  listBackups,
  restoreFromBackup,
  createManualBackup,
  cleanupOldBackups,

  // Utilities
  generateUUID,
  calculateChecksum,
  ensureDirectory,
  atomicWrite
};

// Auto-initialize on module load
if (require.main !== module) {
  initPriceHistory();
  initState();
}
