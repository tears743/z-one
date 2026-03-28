const dataStore = require('./utils/data-store.js');

console.log('✓ Module loaded successfully');
console.log('Available exports:', Object.keys(dataStore).join(', '));

// Test basic operations
console.log('\n--- Testing Operations ---');

try {
  const history = dataStore.readPriceHistory();
  console.log('✓ Price history loaded - version:', history.schema_version);
  console.log('  Records count:', history.records.length);
  
  const state = dataStore.readState();
  console.log('✓ State loaded - status:', state.application_state.status);
  
  // Add a test record
  const record = {
    product_id: 'TEST-001',
    competitor_name: 'TestStore',
    price: 99.99,
    currency: 'USD',
    timestamp: new Date().toISOString(),
    url: 'https://test.com/product',
    status: 'available'
  };
  
  const result = dataStore.addPriceRecord(record);
  console.log('✓ Test record added - ID:', result.record_id.substring(0, 8) + '...');
  console.log('  Checksum:', result.checksum.substring(0, 16) + '...');
  
  // Query records
  const query = dataStore.queryPriceRecords({ product_id: 'TEST-001' });
  console.log('✓ Query returned', query.total, 'records');
  
  // Check backups
  const backups = dataStore.listBackups();
  console.log('✓ Available backups:', backups.length);
  
  console.log('\n=== All Operations Successful ===');
} catch (error) {
  console.error('✗ Error:', error.message);
  console.error(error.stack);
}
