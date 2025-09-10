#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Check for command line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node import-viz-data.js <path_to_viz_json_file>');
  process.exit(1);
}

const inputFile = args[0];
if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found - ${inputFile}`);
  process.exit(1);
}

// Read the JSON data
let reconData;
try {
  reconData = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
} catch (error) {
  console.error('Error parsing JSON file:', error);
  process.exit(1);
}

// Database connection
const dbPath = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to database:', err);
    process.exit(1);
  }
  console.log(`Connected to database: ${dbPath}`);
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

// Clear existing data
function clearTables() {
  const tables = [
    'node_relationships',
    'node_headers',
    'node_technologies',
    'node_vulnerabilities',
    'nodes',
    'websites'
  ];
  
  db.serialize(() => {
    db.run('PRAGMA foreign_keys = OFF');
    tables.forEach(table => {
      db.run(`DELETE FROM ${table}`);
      db.run(`DELETE FROM sqlite_sequence WHERE name='${table}'`);
    });
    db.run('PRAGMA foreign_keys = ON');
    console.log('Existing data cleared from all tables');
  });
}

// Insert a website and get its ID
function insertWebsite(url, name) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare('INSERT INTO websites (url, name) VALUES (?, ?)');
    stmt.run([url, name], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
    stmt.finalize();
  });
}

// Insert a node and get its ID
function insertNode(websiteId, nodeData) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT INTO nodes (
        website_id, value, type, status, size
      ) VALUES (?, ?, ?, ?, ?)
    `);
    
    stmt.run([
      websiteId,
      nodeData.value,
      nodeData.type,
      parseInt(nodeData.status) || 0,
      parseInt(nodeData.size) || 0
    ], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
    stmt.finalize();
  });
}

// Insert headers for a node
function insertHeaders(nodeId, headers) {
  if (!headers || headers.length === 0) return;
  
  const stmt = db.prepare('INSERT INTO node_headers (node_id, name, value) VALUES (?, ?, ?)');
  headers.forEach(header => {
    stmt.run([nodeId, header.key, header.value]);
  });
  stmt.finalize();
}

// Insert technologies for a node
function insertTechnologies(nodeId, technologies) {
  if (!technologies || technologies.length === 0) return;
  
  const stmt = db.prepare('INSERT INTO node_technologies (node_id, name) VALUES (?, ?)');
  technologies.forEach(tech => {
    stmt.run([nodeId, tech]);
  });
  stmt.finalize();
}

// Insert vulnerabilities for a node
function insertVulnerabilities(nodeId, vulnerabilities) {
  if (!vulnerabilities || vulnerabilities.length === 0) return;
  
  const stmt = db.prepare('INSERT INTO node_vulnerabilities (node_id, description) VALUES (?, ?)');
  vulnerabilities.forEach(vuln => {
    stmt.run([nodeId, vuln]);
  });
  stmt.finalize();
}

// Insert relationship between nodes
function insertRelationship(sourceId, targetId, type) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare('INSERT INTO node_relationships (source_node_id, target_node_id, relationship_type) VALUES (?, ?, ?)');
    stmt.run([sourceId, targetId, type], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
    stmt.finalize();
  });
}

// Main function to insert recon data
async function insertReconData() {
  try {
    // Clear existing data
    clearTables();

    // Extract website info from the JSON data
    const websiteUrl = reconData.website.url;
    const websiteName = reconData.website.name || `${websiteUrl} Reconnaissance`;

    // Insert the website
    const websiteId = await insertWebsite(websiteUrl, websiteName);
    console.log(`Website "${websiteName}" inserted with ID: ${websiteId}`);

    // Insert all nodes and store their IDs
    const nodeIds = {};
    
    console.log(`Inserting ${reconData.nodes.length} nodes...`);
    for (const node of reconData.nodes) {
      const nodeId = await insertNode(websiteId, node);
      nodeIds[node.value] = nodeId;
      
      insertHeaders(nodeId, node.headers);
      insertTechnologies(nodeId, node.technologies);
      insertVulnerabilities(nodeId, node.vulnerabilities);
    }
    console.log('All nodes inserted successfully');

    // Insert relationships
    console.log(`Inserting ${reconData.relationships.length} relationships...`);
    for (const rel of reconData.relationships) {
      const sourceId = nodeIds[rel.source];
      const targetId = nodeIds[rel.target];
      
      if (!sourceId) {
        console.warn(`Warning: Source node "${rel.source}" not found for relationship`);
        continue;
      }
      
      if (!targetId) {
        console.warn(`Warning: Target node "${rel.target}" not found for relationship`);
        continue;
      }
      
      await insertRelationship(sourceId, targetId, rel.type);
    }
    console.log('All relationships inserted successfully');

    console.log('\nReconnaissance data imported successfully!');
    console.log(`- Website: ${websiteName}`);
    console.log(`- Nodes: ${reconData.nodes.length}`);
    console.log(`- Relationships: ${reconData.relationships.length}`);
    
  } catch (error) {
    console.error('Error inserting data:', error);
  } finally {
    db.close(() => {
      console.log('Database connection closed');
    });
  }
}

// Run the insertion
insertReconData();
