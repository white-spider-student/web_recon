#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Database connection
const dbPath = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Helper function to promisify database operations
const dbRun = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

const dbGet = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// Main data insertion class
class ReconDataInserter {
  constructor() {
    this.websiteId = null;
  }

  // Create or get website
  async ensureWebsite(url, name = null) {
    try {
      // Check if website exists
      let website = await dbGet('SELECT * FROM websites WHERE url = ?', [url]);
      
      if (!website) {
        // Create new website
        const result = await dbRun(
          'INSERT INTO websites (url, name, last_scan) VALUES (?, ?, CURRENT_TIMESTAMP)',
          [url, name || url]
        );
        this.websiteId = result.id;
        console.log(`✓ Created website: ${url} (ID: ${this.websiteId})`);
      } else {
        this.websiteId = website.id;
        // Update last_scan timestamp
        await dbRun('UPDATE websites SET last_scan = CURRENT_TIMESTAMP WHERE id = ?', [this.websiteId]);
        console.log(`✓ Using existing website: ${url} (ID: ${this.websiteId})`);
      }
      
      return this.websiteId;
    } catch (err) {
      console.error('Error ensuring website:', err.message);
      throw err;
    }
  }

  // Insert a single node with all its related data
  async insertNode(nodeData) {
    const {
      value,           // Required: The node value (URL, subdomain, etc.)
      type = 'unknown', // Node type: domain, subdomain, directory, endpoint, etc.
      status = null,   // HTTP status code
      size = null,     // Response size
      headers = [],    // Array of {key: value} pairs
      technologies = [], // Array of technology strings
      vulnerabilities = [] // Array of vulnerability strings
    } = nodeData;

    try {
      // Insert the main node
      const nodeResult = await dbRun(
        `INSERT INTO nodes (website_id, value, type, status, size) 
         VALUES (?, ?, ?, ?, ?)`,
        [this.websiteId, value, type, status, size]
      );

      const nodeId = nodeResult.id;
      console.log(`  ✓ Inserted node: ${value} (ID: ${nodeId}, Type: ${type})`);

      // Insert headers
      if (headers && headers.length > 0) {
        for (const header of headers) {
          await dbRun(
            'INSERT INTO node_headers (node_id, header_key, header_value) VALUES (?, ?, ?)',
            [nodeId, header.key, header.value]
          );
        }
        console.log(`    ✓ Added ${headers.length} headers`);
      }

      // Insert technologies
      if (technologies && technologies.length > 0) {
        for (const tech of technologies) {
          await dbRun(
            'INSERT INTO node_technologies (node_id, technology) VALUES (?, ?)',
            [nodeId, tech]
          );
        }
        console.log(`    ✓ Added ${technologies.length} technologies`);
      }

      // Insert vulnerabilities
      if (vulnerabilities && vulnerabilities.length > 0) {
        for (const vuln of vulnerabilities) {
          await dbRun(
            'INSERT INTO node_vulnerabilities (node_id, vulnerability) VALUES (?, ?)',
            [nodeId, vuln]
          );
        }
        console.log(`    ✓ Added ${vulnerabilities.length} vulnerabilities`);
      }

      return nodeId;
    } catch (err) {
      console.error(`Error inserting node ${value}:`, err.message);
      throw err;
    }
  }

  // Create relationship between two nodes (by their values)
  async createRelationship(sourceValue, targetValue, relationshipType = 'contains') {
    try {
      // Get source node ID
      const sourceNode = await dbGet(
        'SELECT id FROM nodes WHERE website_id = ? AND value = ?',
        [this.websiteId, sourceValue]
      );

      // Get target node ID
      const targetNode = await dbGet(
        'SELECT id FROM nodes WHERE website_id = ? AND value = ?',
        [this.websiteId, targetValue]
      );

      if (!sourceNode || !targetNode) {
        throw new Error(`Cannot find nodes: source="${sourceValue}" target="${targetValue}"`);
      }

      // Create relationship
      await dbRun(
        'INSERT OR IGNORE INTO node_relationships (source_node_id, target_node_id, relationship_type) VALUES (?, ?, ?)',
        [sourceNode.id, targetNode.id, relationshipType]
      );

      console.log(`  ✓ Created relationship: ${sourceValue} → ${targetValue} (${relationshipType})`);
    } catch (err) {
      console.error(`Error creating relationship ${sourceValue} → ${targetValue}:`, err.message);
      throw err;
    }
  }

  // Bulk insert multiple nodes and their relationships
  async insertReconData(reconData) {
    const { website, nodes, relationships } = reconData;

    try {
      console.log('\n🚀 Starting data insertion...');
      
      // Ensure website exists
      await this.ensureWebsite(website.url, website.name);

      // Insert all nodes
      console.log(`\n📝 Inserting ${nodes.length} nodes...`);
      const nodeIds = new Map(); // value -> database ID
      
      for (const nodeData of nodes) {
        const nodeId = await this.insertNode(nodeData);
        nodeIds.set(nodeData.value, nodeId);
      }

      // Create relationships
      if (relationships && relationships.length > 0) {
        console.log(`\n🔗 Creating ${relationships.length} relationships...`);
        for (const rel of relationships) {
          await this.createRelationship(rel.source, rel.target, rel.type);
        }
      }

      console.log('\n✅ Data insertion completed successfully!');
      
    } catch (err) {
      console.error('\n❌ Error during data insertion:', err.message);
      throw err;
    }
  }

  // Close database connection
  close() {
    return new Promise((resolve) => {
      db.close((err) => {
        if (err) console.error('Error closing database:', err.message);
        else console.log('Database connection closed.');
        resolve();
      });
    });
  }
}

// Example usage function
async function insertExampleData() {
  const inserter = new ReconDataInserter();
  
  // Example reconnaissance data
  const exampleReconData = {
    website: {
      url: 'example.com',
      name: 'Example Target'
    },
    nodes: [
      // Root domain
      {
        value: 'example.com',
        type: 'domain',
        status: 200,
        size: 1024,
        headers: [
          { key: 'Server', value: 'nginx/1.18.0' },
          { key: 'Content-Type', value: 'text/html' }
        ],
        technologies: ['nginx', 'HTML5'],
        vulnerabilities: []
      },
      // Subdomains
      {
        value: 'www.example.com',
        type: 'subdomain',
        status: 200,
        size: 2048,
        headers: [
          { key: 'Server', value: 'nginx/1.18.0' },
          { key: 'X-Powered-By', value: 'PHP/8.1' }
        ],
        technologies: ['nginx', 'PHP', 'WordPress'],
        vulnerabilities: []
      },
      {
        value: 'api.example.com',
        type: 'subdomain',
        status: 200,
        size: 512,
        headers: [
          { key: 'Content-Type', value: 'application/json' }
        ],
        technologies: ['REST API', 'JSON'],
        vulnerabilities: ['Missing rate limiting']
      },
      {
        value: 'admin.example.com',
        type: 'subdomain',
        status: 403,
        size: 256,
        headers: [
          { key: 'Server', value: 'Apache/2.4.41' }
        ],
        technologies: ['Apache'],
        vulnerabilities: ['Directory listing enabled']
      },
      // Directories
      {
        value: 'example.com/admin',
        type: 'directory',
        status: 301,
        size: 0,
        headers: [
          { key: 'Location', value: '/admin/login' }
        ],
        technologies: [],
        vulnerabilities: ['Sensitive directory']
      },
      {
        value: 'example.com/wp-admin',
        type: 'directory',
        status: 200,
        size: 4096,
        headers: [
          { key: 'Set-Cookie', value: 'wordpress_logged_in=...' }
        ],
        technologies: ['WordPress'],
        vulnerabilities: ['Default admin path']
      },
      // Endpoints
      {
        value: 'api.example.com/users',
        type: 'endpoint',
        status: 200,
        size: 1536,
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'X-API-Version', value: '1.0' }
        ],
        technologies: ['REST API'],
        vulnerabilities: ['No authentication required']
      },
      {
        value: 'example.com/backup.sql',
        type: 'file',
        status: 200,
        size: 10240,
        headers: [
          { key: 'Content-Type', value: 'application/sql' }
        ],
        technologies: ['SQL'],
        vulnerabilities: ['Sensitive file exposure', 'Database backup exposed']
      }
    ],
    relationships: [
      // Domain relationships
      { source: 'example.com', target: 'www.example.com', type: 'contains' },
      { source: 'example.com', target: 'api.example.com', type: 'contains' },
      { source: 'example.com', target: 'admin.example.com', type: 'contains' },
      
      // Directory relationships
      { source: 'example.com', target: 'example.com/admin', type: 'contains' },
      { source: 'example.com', target: 'example.com/wp-admin', type: 'contains' },
      
      // Endpoint relationships
      { source: 'api.example.com', target: 'api.example.com/users', type: 'contains' },
      { source: 'example.com', target: 'example.com/backup.sql', type: 'contains' }
    ]
  };

  try {
    await inserter.insertReconData(exampleReconData);
  } catch (err) {
    console.error('Failed to insert example data:', err);
    process.exit(1);
  } finally {
    await inserter.close();
  }
}

// Command line usage
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('📋 Usage examples:');
    console.log('');
    console.log('1. Insert example data:');
    console.log('   node insert-data.js --example');
    console.log('');
    console.log('2. Insert from JSON file:');
    console.log('   node insert-data.js --file data.json');
    console.log('');
    console.log('3. Insert single node programmatically:');
    console.log('   node insert-data.js --interactive');
    console.log('');
    console.log('📝 JSON format example:');
    console.log(`{
  "website": {
    "url": "target.com",
    "name": "My Target"
  },
  "nodes": [
    {
      "value": "target.com",
      "type": "domain",
      "status": 200,
      "size": 1024,
      "headers": [{"key": "Server", "value": "nginx"}],
      "technologies": ["nginx"],
      "vulnerabilities": []
    }
  ],
  "relationships": [
    {"source": "target.com", "target": "www.target.com", "type": "contains"}
  ]
}`);
    return;
  }

  if (args[0] === '--example') {
    await insertExampleData();
  } 
  else if (args[0] === '--file' && args[1]) {
    const fs = require('fs');
    try {
      const jsonData = JSON.parse(fs.readFileSync(args[1], 'utf8'));
      const inserter = new ReconDataInserter();
      await inserter.insertReconData(jsonData);
      await inserter.close();
    } catch (err) {
      console.error('Error reading/parsing JSON file:', err.message);
      process.exit(1);
    }
  }
  else if (args[0] === '--interactive') {
    await interactiveInsertion();
  }
  else {
    console.error('Unknown argument. Use --example, --file <filename>, or --interactive');
    process.exit(1);
  }
}

// Interactive insertion for single nodes
async function interactiveInsertion() {
  const inserter = new ReconDataInserter();
  
  try {
    // Get website info
    const websiteUrl = process.env.WEBSITE_URL || 'example.com';
    const websiteName = process.env.WEBSITE_NAME || 'Example Website';
    
    await inserter.ensureWebsite(websiteUrl, websiteName);

    // Example of inserting individual nodes
    console.log('\n📝 Inserting sample nodes...');

    // You can customize these or read from environment variables
    const nodesToInsert = [
      {
        value: process.env.NODE_VALUE || 'api.example.com/v1/status',
        type: process.env.NODE_TYPE || 'endpoint',
        status: parseInt(process.env.NODE_STATUS) || 200,
        size: parseInt(process.env.NODE_SIZE) || 512,
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'X-API-Version', value: '1.0' }
        ],
        technologies: (process.env.TECHNOLOGIES || 'REST API,JSON').split(','),
        vulnerabilities: (process.env.VULNERABILITIES || '').split(',').filter(v => v.trim())
      }
    ];

    for (const node of nodesToInsert) {
      await inserter.insertNode(node);
    }

    console.log('\n✅ Interactive insertion completed!');
    
  } catch (err) {
    console.error('Error in interactive insertion:', err.message);
    process.exit(1);
  } finally {
    await inserter.close();
  }
}

// Utility functions for different types of recon data

// Insert subdomain enumeration results
async function insertSubdomains(websiteUrl, subdomains) {
  const inserter = new ReconDataInserter();
  try {
    await inserter.ensureWebsite(websiteUrl);
    
    for (const subdomain of subdomains) {
      await inserter.insertNode({
        value: subdomain.name,
        type: 'subdomain',
        status: subdomain.status || null,
        size: subdomain.size || null,
        headers: subdomain.headers || [],
        technologies: subdomain.technologies || [],
        vulnerabilities: subdomain.vulnerabilities || []
      });
      
      // Create relationship to parent domain
      if (subdomain.name !== websiteUrl) {
        await inserter.createRelationship(websiteUrl, subdomain.name, 'contains');
      }
    }
  } finally {
    await inserter.close();
  }
}

// Insert directory enumeration results
async function insertDirectories(websiteUrl, directories) {
  const inserter = new ReconDataInserter();
  try {
    await inserter.ensureWebsite(websiteUrl);
    
    for (const dir of directories) {
      await inserter.insertNode({
        value: dir.path,
        type: 'directory',
        status: dir.status || null,
        size: dir.size || null,
        headers: dir.headers || [],
        technologies: dir.technologies || [],
        vulnerabilities: dir.vulnerabilities || []
      });
      
      // Create relationship to parent
      const parentPath = dir.parent || websiteUrl;
      await inserter.createRelationship(parentPath, dir.path, 'contains');
    }
  } finally {
    await inserter.close();
  }
}

// Insert port scan results
async function insertPorts(websiteUrl, ports) {
  const inserter = new ReconDataInserter();
  try {
    await inserter.ensureWebsite(websiteUrl);
    
    for (const port of ports) {
      await inserter.insertNode({
        value: `${websiteUrl}:${port.number}`,
        type: 'port',
        status: port.state === 'open' ? 200 : 403,
        size: null,
        headers: [],
        technologies: port.service ? [port.service] : [],
        vulnerabilities: port.vulnerabilities || []
      });
      
      // Create relationship to domain
      await inserter.createRelationship(websiteUrl, `${websiteUrl}:${port.number}`, 'hosts');
    }
  } finally {
    await inserter.close();
  }
}

// Export functions for use as module
module.exports = {
  ReconDataInserter,
  insertSubdomains,
  insertDirectories,
  insertPorts
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
