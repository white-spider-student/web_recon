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
  const fs = require('fs');
  const schema = fs.readFileSync('./schema.sql', 'utf8');
  
  // Execute schema file
  db.exec(schema, (err) => {
    if (err) {
      console.error('Error initializing database:', err.message);
    } else {
      console.log('Database initialized successfully');
    }
  });
}

function createIndexes() {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_nodes_website_id ON nodes(website_id)',
    'CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)',
    'CREATE INDEX IF NOT EXISTS idx_nodes_value ON nodes(value)'
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
app.get('/websites/:websiteId/nodes', async (req, res) => {
  const { websiteId } = req.params;
  console.log('Fetching nodes for website:', websiteId);

  try {
    const nodesQuery = `
      SELECT 
        id,
        value,
        type,
        status,
        size
      FROM nodes 
      WHERE website_id = ?
    `;
    
    // Log the count of nodes
    db.get('SELECT COUNT(*) as count FROM nodes WHERE website_id = ?', [websiteId], (err, row) => {
      if (err) console.error('Error counting nodes:', err);
      else console.log('Number of nodes found:', row.count);
    });
    
    const relationshipsQuery = `
      SELECT 
        source_node_id as source,
        target_node_id as target,
        relationship_type as type
      FROM node_relationships 
      WHERE EXISTS (
        SELECT 1 FROM nodes 
        WHERE nodes.id = node_relationships.source_node_id 
        AND nodes.website_id = ?
      )
    `;

    const nodes = await new Promise((resolve, reject) => {
      db.all(nodesQuery, [websiteId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(node => ({
          id: String(node.id),
          label: node.value,
          group: node.type || 'unknown',
          type: node.type || 'unknown',
          value: node.value,
          status: node.status,
          size: node.size
        })));
      });
    });

    const relationships = await new Promise((resolve, reject) => {
      db.all(relationshipsQuery, [websiteId], (err, rows) => {
        if (err) reject(err);
        else resolve((rows || []).map(rel => ({
          source: String(rel.source),
          target: String(rel.target),
          type: rel.type || 'contains'
        })));
      });
    });

    res.json({
      nodes,
      relationships
    });

  } catch (err) {
    console.error('Error fetching nodes and relationships:', err.message);
    res.status(500).json({ error: 'Failed to fetch graph data', details: err.message });
  }
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
