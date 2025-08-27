const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Initialize SQLite database
const db = new sqlite3.Database('./data.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    initializeDatabase();
  }
});

function initializeDatabase() {
  // Create websites table
  db.run(`CREATE TABLE IF NOT EXISTS websites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE NOT NULL,
    name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_scan TIMESTAMP
  )`, (err) => {
    if (err) console.error('Error creating websites table:', err.message);
  });
  
  // Create nodes table
  db.run(`CREATE TABLE IF NOT EXISTS nodes (
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
  )`, (err) => {
    if (err) console.error('Error creating nodes table:', err.message);
  });
  
  // Create node_headers table
  db.run(`CREATE TABLE IF NOT EXISTS node_headers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL,
    header_key TEXT NOT NULL,
    header_value TEXT NOT NULL,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
  )`, (err) => {
    if (err) console.error('Error creating node_headers table:', err.message);
  });
  
  // Create node_technologies table
  db.run(`CREATE TABLE IF NOT EXISTS node_technologies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL,
    technology TEXT NOT NULL,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
  )`, (err) => {
    if (err) console.error('Error creating node_technologies table:', err.message);
  });
  
  // Create node_vulnerabilities table
  db.run(`CREATE TABLE IF NOT EXISTS node_vulnerabilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL,
    vulnerability TEXT NOT NULL,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
  )`, (err) => {
    if (err) console.error('Error creating node_vulnerabilities table:', err.message);
  });
  
  // Create node_relationships table
  db.run(`CREATE TABLE IF NOT EXISTS node_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_node_id INTEGER NOT NULL,
    target_node_id INTEGER NOT NULL,
    relationship_type TEXT,
    FOREIGN KEY (source_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    UNIQUE(source_node_id, target_node_id)
  )`, (err) => {
    if (err) console.error('Error creating node_relationships table:', err.message);
  });
  
  // Create indexes
  createIndexes();
}

function createIndexes() {
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
  
  indexes.forEach(index => {
    db.run(index, (err) => {
      if (err) console.error('Error creating index:', err.message);
    });
  });
}

// API Endpoints

// Get all websites
app.get('/websites', (req, res) => {
  db.all('SELECT * FROM websites', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

// Create a new website
app.post('/websites', (req, res) => {
  const { url, name } = req.body;
  const query = `INSERT INTO websites (url, name) VALUES (?, ?)`;
  
  db.run(query, [url, name], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(201).json({ id: this.lastID, url, name });
    }
  });
});

// Get all nodes for a specific website
app.get('/websites/:websiteId/nodes', (req, res) => {
  const websiteId = req.params.websiteId;
  const query = `
    SELECT n.*, 
           json_group_array(json_object('key', h.header_key, 'value', h.header_value)) as headers,
           json_group_array(t.technology) as technologies,
           json_group_array(v.vulnerability) as vulnerabilities
    FROM nodes n
    LEFT JOIN node_headers h ON n.id = h.node_id
    LEFT JOIN node_technologies t ON n.id = t.node_id
    LEFT JOIN node_vulnerabilities v ON n.id = v.node_id
    WHERE n.website_id = ?
    GROUP BY n.id
  `;
  
  db.all(query, [websiteId], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      // Process the results to format them properly
      const processedRows = rows.map(row => {
        // Parse headers
        let headers = [];
        try {
          headers = JSON.parse(row.headers);
          // Filter out null values and format properly
          headers = headers.filter(h => h.key !== null);
        } catch (e) {
          headers = [];
        }
        
        // Parse technologies
        let technologies = [];
        try {
          technologies = JSON.parse(row.technologies);
          technologies = technologies.filter(t => t !== null);
        } catch (e) {
          technologies = [];
        }
        
        // Parse vulnerabilities
        let vulnerabilities = [];
        try {
          vulnerabilities = JSON.parse(row.vulnerabilities);
          vulnerabilities = vulnerabilities.filter(v => v !== null);
        } catch (e) {
          vulnerabilities = [];
        }
        
        return {
          ...row,
          headers,
          technologies,
          vulnerabilities
        };
      });
      
      res.json(processedRows);
    }
  });
});

// Get all nodes (across all websites)
app.get('/nodes', (req, res) => {
  const query = `
    SELECT n.*, 
           w.url as website_url,
           json_group_array(json_object('key', h.header_key, 'value', h.header_value)) as headers,
           json_group_array(t.technology) as technologies,
           json_group_array(v.vulnerability) as vulnerabilities
    FROM nodes n
    LEFT JOIN websites w ON n.website_id = w.id
    LEFT JOIN node_headers h ON n.id = h.node_id
    LEFT JOIN node_technologies t ON n.id = t.node_id
    LEFT JOIN node_vulnerabilities v ON n.id = v.node_id
    GROUP BY n.id
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      // Process the results to format them properly
      const processedRows = rows.map(row => {
        // Parse headers
        let headers = [];
        try {
          headers = JSON.parse(row.headers);
          // Filter out null values and format properly
          headers = headers.filter(h => h.key !== null);
        } catch (e) {
          headers = [];
        }
        
        // Parse technologies
        let technologies = [];
        try {
          technologies = JSON.parse(row.technologies);
          technologies = technologies.filter(t => t !== null);
        } catch (e) {
          technologies = [];
        }
        
        // Parse vulnerabilities
        let vulnerabilities = [];
        try {
          vulnerabilities = JSON.parse(row.vulnerabilities);
          vulnerabilities = vulnerabilities.filter(v => v !== null);
        } catch (e) {
          vulnerabilities = [];
        }
        
        return {
          ...row,
          headers,
          technologies,
          vulnerabilities
        };
      });
      
      res.json(processedRows);
    }
  });
});

// Save new node data
app.post('/websites/:websiteId/nodes', (req, res) => {
  const websiteId = req.params.websiteId;
  const { nodeId, type, groupName, status, responseSize, method, fileType, description, headers, technologies, vulnerabilities } = req.body;
  
  // Start a transaction
  db.serialize(() => {
    db.run('BEGIN TRANSACTION;');
    
    // Insert node data
    const nodeQuery = `
      INSERT INTO nodes (website_id, node_id, type, group_name, status, response_size, method, file_type, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const nodeParams = [
      websiteId,
      nodeId,
      type,
      groupName,
      status,
      responseSize,
      method,
      fileType,
      description
    ];
    
    db.run(nodeQuery, nodeParams, function (err) {
      if (err) {
        db.run('ROLLBACK;');
        return res.status(500).json({ error: err.message });
      }
      
      const newNodeId = this.lastID;
      
      // Insert headers if provided
      if (headers && Array.isArray(headers)) {
        const headerQuery = `INSERT INTO node_headers (node_id, header_key, header_value) VALUES (?, ?, ?)`;
        headers.forEach(header => {
          db.run(headerQuery, [newNodeId, header.key, header.value], (err) => {
            if (err) {
              console.error('Error inserting header:', err.message);
            }
          });
        });
      }
      
      // Insert technologies if provided
      if (technologies && Array.isArray(technologies)) {
        const techQuery = `INSERT INTO node_technologies (node_id, technology) VALUES (?, ?)`;
        technologies.forEach(tech => {
          db.run(techQuery, [newNodeId, tech], (err) => {
            if (err) {
              console.error('Error inserting technology:', err.message);
            }
          });
        });
      }
      
      // Insert vulnerabilities if provided
      if (vulnerabilities && Array.isArray(vulnerabilities)) {
        const vulnQuery = `INSERT INTO node_vulnerabilities (node_id, vulnerability) VALUES (?, ?)`;
        vulnerabilities.forEach(vuln => {
          db.run(vulnQuery, [newNodeId, vuln], (err) => {
            if (err) {
              console.error('Error inserting vulnerability:', err.message);
            }
          });
        });
      }
      
      // Commit transaction
      db.run('COMMIT;', (err) => {
        if (err) {
          db.run('ROLLBACK;');
          res.status(500).json({ error: err.message });
        } else {
          res.status(201).json({ id: newNodeId, nodeId, websiteId });
        }
      });
    });
  });
});

// Create a relationship between two nodes
app.post('/nodes/:sourceNodeId/relationships/:targetNodeId', (req, res) => {
  const sourceNodeId = req.params.sourceNodeId;
  const targetNodeId = req.params.targetNodeId;
  const { relationshipType } = req.body;
  
  const query = `INSERT INTO node_relationships (source_node_id, target_node_id, relationship_type) VALUES (?, ?, ?)`;
  
  db.run(query, [sourceNodeId, targetNodeId, relationshipType], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(201).json({ id: this.lastID, sourceNodeId, targetNodeId, relationshipType });
    }
  });
});

// Get relationships for a node
app.get('/nodes/:nodeId/relationships', (req, res) => {
  const nodeId = req.params.nodeId;
  const query = `
    SELECT nr.*, 
           s.node_id as source_node_id_text,
           t.node_id as target_node_id_text
    FROM node_relationships nr
    JOIN nodes s ON nr.source_node_id = s.id
    JOIN nodes t ON nr.target_node_id = t.id
    WHERE nr.source_node_id = ? OR nr.target_node_id = ?
  `;
  
  db.all(query, [nodeId, nodeId], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
