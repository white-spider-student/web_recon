const sqlite3 = require('sqlite3').verbose();

// Connect to SQLite database
const db = new sqlite3.Database('./data.db');

function createIndexes() {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_nodes_website_id ON nodes(website_id)',
    'CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)',
    'CREATE INDEX IF NOT EXISTS idx_nodes_value ON nodes(value)',
    'CREATE INDEX IF NOT EXISTS idx_node_headers_node_id ON node_headers(node_id)',
    'CREATE INDEX IF NOT EXISTS idx_node_technologies_node_id ON node_technologies(node_id)',
    'CREATE INDEX IF NOT EXISTS idx_node_vulnerabilities_node_id ON node_vulnerabilities(node_id)',
    'CREATE INDEX IF NOT EXISTS idx_node_relationships_source ON node_relationships(source_node_id)',
    'CREATE INDEX IF NOT EXISTS idx_node_relationships_target ON node_relationships(target_node_id)'
  ];

  indexes.forEach(index => {
    db.run(index, err => {
      if (err) console.error('Error creating index:', err.message);
    });
  });
}

// Create tables one by one
db.serialize(() => {
  // Create websites table
  db.run(`CREATE TABLE IF NOT EXISTS websites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE NOT NULL,
    name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_scan TIMESTAMP
  )`);

  // Create nodes table
  db.run(`CREATE TABLE IF NOT EXISTS nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    website_id INTEGER NOT NULL,
    value TEXT NOT NULL,
    type TEXT,
    status INTEGER,
    size INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
  )`);

  // Create node_headers table
  db.run(`CREATE TABLE IF NOT EXISTS node_headers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL,
    header_key TEXT NOT NULL,
    header_value TEXT NOT NULL,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
  )`);

  // Create node_technologies table
  db.run(`CREATE TABLE IF NOT EXISTS node_technologies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL,
    technology TEXT NOT NULL,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
  )`);

  // Create node_vulnerabilities table
  db.run(`CREATE TABLE IF NOT EXISTS node_vulnerabilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL,
    vulnerability TEXT NOT NULL,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
  )`);

  // Create node_relationships table
  db.run(`CREATE TABLE IF NOT EXISTS node_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_node_id INTEGER NOT NULL,
    target_node_id INTEGER NOT NULL,
    relationship_type TEXT,
    FOREIGN KEY (source_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    UNIQUE(source_node_id, target_node_id)
  )`);

  // Create indexes
  createIndexes();

    // Create relationships table
    db.run(`
        CREATE TABLE IF NOT EXISTS relationships (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id INTEGER,
            target_id INTEGER,
            type TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (source_id) REFERENCES nodes(id),
            FOREIGN KEY (target_id) REFERENCES nodes(id)
        )
    `);

    // Create indexes
    db.run('CREATE INDEX IF NOT EXISTS idx_nodes_domain ON nodes(domain_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)');
    db.run('CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id)');

    console.log('Database schema created successfully!');
    db.close();
});
