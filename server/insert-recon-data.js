const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Read the JSON file
const reconData = require('./example-recon.json');

// Convert data format if needed
const websiteData = {
  domain: reconData.domain,
  nodes: reconData.nodes.map(node => ({
    ...node,
    value: node.value || node.label
  }))
};

// Connect to SQLite database
const db = new sqlite3.Database('./data.db');

// Begin transaction
db.serialize(() => {
  db.run('BEGIN TRANSACTION');

  try {
    // Insert website
    const websiteStmt = db.prepare('INSERT INTO websites (url, name) VALUES (?, ?)');
    websiteStmt.run(reconData.domain, reconData.domain);
    websiteStmt.finalize();

    // Get the last inserted website id
    db.get('SELECT last_insert_rowid() as websiteId', (err, row) => {
      if (err) throw err;
      const websiteId = row.websiteId;

      // Prepare statements for nodes
      const nodeStmt = db.prepare(`
        INSERT INTO nodes (
          website_id, type, value, status, size
        ) VALUES (?, ?, ?, ?, ?)
      `);

      const relationshipStmt = db.prepare(`
        INSERT INTO relationships (source_id, target_id, type)
        VALUES (
          (SELECT id FROM nodes WHERE value = ? LIMIT 1),
          (SELECT id FROM nodes WHERE value = ? LIMIT 1),
          ?
        )
      `);

      // Insert nodes
      reconData.nodes.forEach(node => {
        nodeStmt.run(
          websiteId,
          node.type,
          node.value || node.label,
          node.status,
          node.size
        );
      });

      // Insert relationships
      reconData.relationships.forEach(rel => {
        relationshipStmt.run(rel.source, rel.target, rel.type);
      });

      // Finalize statements
      nodeStmt.finalize();
      relationshipStmt.finalize();

      // Commit transaction
      db.run('COMMIT', (err) => {
        if (err) {
          console.error('Error committing transaction:', err);
          db.run('ROLLBACK');
        } else {
          console.log('Data inserted successfully!');
        }
        
        // Close the database connection
        db.close();
      });
    });
  } catch (error) {
    console.error('Error during insertion:', error);
    db.run('ROLLBACK');
    db.close();
  }
});
