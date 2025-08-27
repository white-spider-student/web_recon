const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Initialize SQLite database
const db = new sqlite3.Database('./data.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    migrateSchema();
  }
});

function migrateSchema() {
  // Begin transaction
  db.serialize(() => {
    db.run('BEGIN TRANSACTION;');
    
    // Create new tables
    createNewTables(() => {
      // Migrate existing data
      migrateData(() => {
        // Create indexes
        createIndexes(() => {
          // Commit transaction
          db.run('COMMIT;', (err) => {
            if (err) {
              console.error('Error committing transaction:', err.message);
              db.run('ROLLBACK;');
            } else {
              console.log('Migration completed successfully.');
              db.close();
            }
          });
        });
      });
    });
  });
}

function createNewTables(callback) {
  console.log('Creating new table structures...');
  
  const tables = [
    `CREATE TABLE IF NOT EXISTS websites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_scan TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      website_id INTEGER NOT NULL,
      node_id TEXT NOT NULL,
      type TEXT,
      group_name TEXT,
      status TEXT,
      response_size TEXT,
      method TEXT,
      file_type TEXT,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
      UNIQUE(website_id, node_id)
    )`,
    `CREATE TABLE IF NOT EXISTS node_headers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id INTEGER NOT NULL,
      header_key TEXT NOT NULL,
      header_value TEXT NOT NULL,
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS node_technologies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id INTEGER NOT NULL,
      technology TEXT NOT NULL,
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS node_vulnerabilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id INTEGER NOT NULL,
      vulnerability TEXT NOT NULL,
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS node_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_node_id INTEGER NOT NULL,
      target_node_id INTEGER NOT NULL,
      relationship_type TEXT,
      FOREIGN KEY (source_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (target_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
      UNIQUE(source_node_id, target_node_id)
    )`
  ];

  let created = 0;
  tables.forEach((table) => {
    db.run(table, (err) => {
      if (err) {
        console.error('Error creating table:', err.message);
      }
      created++;
      if (created === tables.length) {
        console.log('New table structures created.');
        callback();
      }
    });
  });
}

function migrateData(callback) {
  console.log('Migrating existing data...');
  
  // Check if old nodes table exists and hasn't been renamed yet
  db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='nodes_old'`, (err, row) => {
    if (err) {
      console.error('Error checking for old nodes table:', err.message);
      callback();
      return;
    }
    
    // If nodes_old already exists, we've already migrated
    if (row) {
      console.log('Data already migrated.');
      callback();
      return;
    }
    
    // Check if the old nodes table exists
    db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='nodes'`, (err, row) => {
      if (err) {
        console.error('Error checking for nodes table:', err.message);
        callback();
        return;
      }
      
      if (!row) {
        console.log('No existing nodes table to migrate.');
        callback();
        return;
      }
      
      // Rename old nodes table
      db.run(`ALTER TABLE nodes RENAME TO nodes_old`, (err) => {
        if (err) {
          console.error('Error renaming old nodes table:', err.message);
          callback();
          return;
        }
        
        // Create a default website for existing data
        db.run(`INSERT OR IGNORE INTO websites (url, name) VALUES ('default.com', 'Default Website')`, function(err) {
          if (err) {
            console.error('Error creating default website:', err.message);
            callback();
            return;
          }
          
          const defaultWebsiteId = this.lastID || 1;
          console.log(`Created default website with ID: ${defaultWebsiteId}`);
          
          // Migrate nodes data
          db.all(`SELECT * FROM nodes_old`, (err, rows) => {
            if (err) {
              console.error('Error fetching old nodes:', err.message);
              callback();
              return;
            }
            
            if (!rows || rows.length === 0) {
              console.log('No existing data to migrate.');
              callback();
              return;
            }
            
            let migratedCount = 0;
            let totalRows = rows.length;
            
            rows.forEach(row => {
              // Insert node data
              const nodeQuery = `INSERT OR IGNORE INTO nodes (
                website_id, node_id, status, response_size, description
              ) VALUES (?, ?, ?, ?, ?)`;
              
              const nodeParams = [
                defaultWebsiteId,
                row.id, // Using old id as node_id
                row.status,
                row.responseSize,
                '' // No description in old schema
              ];
              
              db.run(nodeQuery, nodeParams, function(err) {
                if (err) {
                  console.error('Error inserting node:', err.message);
                  migratedCount++;
                  if (migratedCount === totalRows) {
                    console.log(`Migrated ${migratedCount} nodes.`);
                    callback();
                  }
                  return;
                }
                
                const newNodeId = this.lastID;
                migratedCount++;
                
                // Parse and insert headers if they exist
                if (row.headers) {
                  try {
                    const headers = JSON.parse(row.headers);
                    if (Array.isArray(headers)) {
                      headers.forEach(header => {
                        const headerQuery = `INSERT INTO node_headers (node_id, header_key, header_value) VALUES (?, ?, ?)`;
                        db.run(headerQuery, [newNodeId, header.key, header.value], (err) => {
                          if (err) console.error('Error inserting header:', err.message);
                        });
                      });
                    }
                  } catch (e) {
                    console.error('Error parsing headers:', e.message);
                  }
                }
                
                // Parse and insert technologies if they exist
                if (row.technologies) {
                  try {
                    const technologies = JSON.parse(row.technologies);
                    if (Array.isArray(technologies)) {
                      technologies.forEach(tech => {
                        const techQuery = `INSERT INTO node_technologies (node_id, technology) VALUES (?, ?)`;
                        db.run(techQuery, [newNodeId, tech], (err) => {
                          if (err) console.error('Error inserting technology:', err.message);
                        });
                      });
                    }
                  } catch (e) {
                    console.error('Error parsing technologies:', e.message);
                  }
                }
                
                // Parse and insert vulnerabilities if they exist
                if (row.vulnerabilities) {
                  try {
                    const vulnerabilities = JSON.parse(row.vulnerabilities);
                    if (Array.isArray(vulnerabilities)) {
                      vulnerabilities.forEach(vuln => {
                        const vulnQuery = `INSERT INTO node_vulnerabilities (node_id, vulnerability) VALUES (?, ?)`;
                        db.run(vulnQuery, [newNodeId, vuln], (err) => {
                          if (err) console.error('Error inserting vulnerability:', err.message);
                        });
                      });
                    }
                  } catch (e) {
                    console.error('Error parsing vulnerabilities:', e.message);
                  }
                }
                
                // Check if all rows have been processed
                if (migratedCount === totalRows) {
                  console.log(`Migrated ${migratedCount} nodes.`);
                  callback();
                }
              });
            });
          });
        });
      });
    });
  });
}

function createIndexes(callback) {
  console.log('Creating indexes...');
  
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_nodes_website_id ON nodes(website_id)',
    'CREATE INDEX IF NOT EXISTS idx_node_headers_node_id ON node_headers(node_id)',
    'CREATE INDEX IF NOT EXISTS idx_node_technologies_node_id ON node_technologies(node_id)',
    'CREATE INDEX IF NOT EXISTS idx_node_vulnerabilities_node_id ON node_vulnerabilities(node_id)',
    'CREATE INDEX IF NOT EXISTS idx_node_relationships_source ON node_relationships(source_node_id)',
    'CREATE INDEX IF NOT EXISTS idx_node_relationships_target ON node_relationships(target_node_id)',
    'CREATE INDEX IF NOT EXISTS idx_nodes_website_node_id ON nodes(website_id, node_id)',
    'CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)',
    'CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status)',
    'CREATE INDEX IF NOT EXISTS idx_nodes_last_seen ON nodes(last_seen)',
    'CREATE INDEX IF NOT EXISTS idx_websites_last_scan ON websites(last_scan)',
    'CREATE INDEX IF NOT EXISTS idx_nodes_file_type ON nodes(file_type)',
    'CREATE INDEX IF NOT EXISTS idx_nodes_website_type ON nodes(website_id, type)',
    'CREATE INDEX IF NOT EXISTS idx_nodes_website_status ON nodes(website_id, status)'
  ];
  
  let created = 0;
  indexes.forEach(index => {
    db.run(index, (err) => {
      if (err) {
        console.error('Error creating index:', err.message);
      }
      created++;
      if (created === indexes.length) {
        console.log('All indexes created.');
        callback();
      }
    });
  });
}