const sqlite3 = require('sqlite3').verbose();

// Initialize SQLite database
const db = new sqlite3.Database('./data.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    seedDatabase();
  }
});

function seedDatabase() {
  // Create tables if they don't exist
  createTables(() => {
    // Insert a default website
    insertDefaultWebsite(() => {
      // Insert sample nodes
      insertSampleNodes(() => {
        // Insert relationships between nodes
        insertSampleRelationships(() => {
          db.close((err) => {
            if (err) {
              console.error('Error closing database:', err.message);
            } else {
              console.log('Database seeding completed.');
            }
          });
        });
      });
    });
  });
}

function createTables(callback) {
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
        console.log('Tables created successfully.');
        callback();
      }
    });
  });
}

function insertDefaultWebsite(callback) {
  const query = `INSERT OR IGNORE INTO websites (url, name) VALUES (?, ?)`;
  db.run(query, ['example.com', 'Example Website'], function(err) {
    if (err) {
      console.error('Error inserting default website:', err.message);
    } else {
      console.log('Default website inserted.');
    }
    callback();
  });
}

function insertSampleNodes(callback) {
  // Get the website ID
  db.get(`SELECT id FROM websites WHERE url = 'example.com'`, (err, row) => {
    if (err) {
      console.error('Error fetching website:', err.message);
      callback();
      return;
    }
    
    const websiteId = row ? row.id : 1;
    
    // Sample nodes data
    const nodes = [
      {
        website_id: websiteId,
        node_id: 'node1',
        type: 'endpoint',
        group_name: 'endpoint',
        status: '200 OK',
        response_size: '2.4 KB',
        method: 'GET',
        description: 'Main API endpoint',
        headers: [
          { key: 'Content-Type', value: 'text/html' },
          { key: 'Content-Length', value: '2457' }
        ],
        technologies: ['React', 'Node.js'],
        vulnerabilities: ['Open directory']
      },
      {
        website_id: websiteId,
        node_id: 'node2',
        type: 'directory',
        group_name: 'directory',
        status: '403 Forbidden',
        response_size: '1.2 KB',
        method: 'GET',
        description: 'Admin directory',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'Content-Length', value: '1234' }
        ],
        technologies: ['Express', 'SQLite'],
        vulnerabilities: ['SQL Injection']
      },
      {
        website_id: websiteId,
        node_id: 'api.example.com',
        type: 'subdomain',
        group_name: 'subdomain',
        status: '200 OK',
        response_size: '3.1 KB',
        method: 'GET',
        description: 'API subdomain',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'Server', value: 'nginx' }
        ],
        technologies: ['Express', 'MongoDB'],
        vulnerabilities: []
      }
    ];

    let inserted = 0;
    nodes.forEach((node) => {
      const query = `
        INSERT INTO nodes (website_id, node_id, type, group_name, status, response_size, method, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const params = [
        node.website_id,
        node.node_id,
        node.type,
        node.group_name,
        node.status,
        node.response_size,
        node.method,
        node.description
      ];

      db.run(query, params, function (err) {
        if (err) {
          console.error('Error inserting node:', err.message);
        } else {
          const newNodeId = this.lastID;
          console.log(`Inserted node: ${node.node_id}`);
          
          // Insert headers
          if (node.headers && Array.isArray(node.headers)) {
            node.headers.forEach(header => {
              const headerQuery = `INSERT INTO node_headers (node_id, header_key, header_value) VALUES (?, ?, ?)`;
              db.run(headerQuery, [newNodeId, header.key, header.value], (err) => {
                if (err) {
                  console.error('Error inserting header:', err.message);
                }
              });
            });
          }
          
          // Insert technologies
          if (node.technologies && Array.isArray(node.technologies)) {
            node.technologies.forEach(tech => {
              const techQuery = `INSERT INTO node_technologies (node_id, technology) VALUES (?, ?)`;
              db.run(techQuery, [newNodeId, tech], (err) => {
                if (err) {
                  console.error('Error inserting technology:', err.message);
                }
              });
            });
          }
          
          // Insert vulnerabilities
          if (node.vulnerabilities && Array.isArray(node.vulnerabilities)) {
            node.vulnerabilities.forEach(vuln => {
              const vulnQuery = `INSERT INTO node_vulnerabilities (node_id, vulnerability) VALUES (?, ?)`;
              db.run(vulnQuery, [newNodeId, vuln], (err) => {
                if (err) {
                  console.error('Error inserting vulnerability:', err.message);
                }
              });
            });
          }
        }
        
        inserted++;
        if (inserted === nodes.length) {
          console.log('Sample nodes inserted.');
          callback();
        }
      });
    });
  });
}

function insertSampleRelationships(callback) {
  // For now, we'll just log that this step is complete
  // In a real implementation, you would insert actual relationships
  console.log('Sample relationships step completed.');
  callback();
}
