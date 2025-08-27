const sqlite3 = require('sqlite3').verbose();

// Initialize SQLite database
const db = new sqlite3.Database('./data.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    validateSchema();
  }
});

function validateSchema() {
  console.log('Validating database schema...');
  
  // Check if all tables exist
  const tables = ['websites', 'nodes', 'node_headers', 'node_technologies', 'node_vulnerabilities', 'node_relationships'];
  
  let validated = 0;
  tables.forEach(table => {
    db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table], (err, row) => {
      if (err) {
        console.error(`Error checking table ${table}:`, err.message);
      } else if (row) {
        console.log(`✓ Table ${table} exists`);
      } else {
        console.log(`✗ Table ${table} does not exist`);
      }
      
      validated++;
      if (validated === tables.length) {
        // Check data integrity
        checkDataIntegrity();
      }
    });
  });
}

function checkDataIntegrity() {
  console.log('\nChecking data integrity...');
  
  // Check if websites exist
  db.all('SELECT * FROM websites', [], (err, rows) => {
    if (err) {
      console.error('Error fetching websites:', err.message);
    } else {
      console.log(`Found ${rows.length} website(s)`);
      rows.forEach(row => {
        console.log(`  - Website ID: ${row.id}, URL: ${row.url}`);
      });
    }
    
    // Check if nodes exist
    db.all('SELECT * FROM nodes', [], (err, rows) => {
      if (err) {
        console.error('Error fetching nodes:', err.message);
      } else {
        console.log(`Found ${rows.length} node(s)`);
        rows.forEach(row => {
          console.log(`  - Node ID: ${row.id}, Website ID: ${row.website_id}, Node ID: ${row.node_id}, Status: ${row.status}`);
        });
      }
      
      // Check if node attributes exist
      db.all('SELECT COUNT(*) as count FROM node_headers', [], (err, rows) => {
        if (!err && rows.length > 0) {
          console.log(`Found ${rows[0].count} node header(s)`);
        }
        
        db.all('SELECT COUNT(*) as count FROM node_technologies', [], (err, rows) => {
          if (!err && rows.length > 0) {
            console.log(`Found ${rows[0].count} node technology(ies)`);
          }
          
          db.all('SELECT COUNT(*) as count FROM node_vulnerabilities', [], (err, rows) => {
            if (!err && rows.length > 0) {
              console.log(`Found ${rows[0].count} node vulnerability(ies)`);
            }
            
            console.log('\nSchema validation completed.');
            db.close();
          });
        });
      });
    });
  });
}