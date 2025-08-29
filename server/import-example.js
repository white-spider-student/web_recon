const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Read the example JSON file
const jsonData = JSON.parse(fs.readFileSync(path.join(__dirname, 'example-recon.json'), 'utf8'));

// Initialize SQLite database
const db = new sqlite3.Database('./data.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('Connected to SQLite database.');
    importData();
  }
});

function importData() {
  console.log('Starting import...');
  
  // Start a transaction
  db.serialize(() => {
    db.run('BEGIN TRANSACTION;');
    
    // 1. Insert website
    const website = jsonData.website;
    db.run(
      'INSERT OR REPLACE INTO websites (url, name) VALUES (?, ?)',
      [website.url, website.name],
      function(err) {
        if (err) {
          console.error('Error inserting website:', err.message);
          db.run('ROLLBACK;');
          return;
        }
        
        const websiteId = this.lastID;
        console.log(`Inserted website: ${website.name} (ID: ${websiteId})`);
        
        // 2. Insert nodes
        const nodes = jsonData.nodes;
        let nodesInserted = 0;
        
        nodes.forEach((node, index) => {
          db.run(
            'INSERT OR REPLACE INTO nodes (website_id, value, type, status, size) VALUES (?, ?, ?, ?, ?)',
            [websiteId, node.value, node.type, node.status, node.size],
            function(err) {
              if (err) {
                console.error(`Error inserting node ${node.value}:`, err.message);
                return;
              }
              
              const nodeId = this.lastID;
              nodesInserted++;
              
              // 3. Insert headers
              if (node.headers && Array.isArray(node.headers)) {
                node.headers.forEach(header => {
                  db.run(
                    'INSERT OR REPLACE INTO node_headers (node_id, header_key, header_value) VALUES (?, ?, ?)',
                    [nodeId, header.key, header.value]
                  );
                });
              }
              
              // 4. Insert technologies
              if (node.technologies && Array.isArray(node.technologies)) {
                node.technologies.forEach(tech => {
                  db.run(
                    'INSERT OR REPLACE INTO node_technologies (node_id, technology) VALUES (?, ?)',
                    [nodeId, tech]
                  );
                });
              }
              
              // 5. Insert vulnerabilities
              if (node.vulnerabilities && Array.isArray(node.vulnerabilities)) {
                node.vulnerabilities.forEach(vuln => {
                  db.run(
                    'INSERT OR REPLACE INTO node_vulnerabilities (node_id, vulnerability) VALUES (?, ?)',
                    [nodeId, vuln]
                  );
                });
              }
              
              // Check if all nodes are processed
              if (nodesInserted === nodes.length) {
                // 6. Insert relationships
                const relationships = jsonData.relationships;
                let relationshipsInserted = 0;
                
                relationships.forEach(rel => {
                  // Find source and target node IDs
                  db.get('SELECT id FROM nodes WHERE value = ? AND website_id = ?', [rel.source, websiteId], (err, sourceNode) => {
                    if (err || !sourceNode) {
                      console.error(`Source node not found: ${rel.source}`);
                      return;
                    }
                    
                    db.get('SELECT id FROM nodes WHERE value = ? AND website_id = ?', [rel.target, websiteId], (err, targetNode) => {
                      if (err || !targetNode) {
                        console.error(`Target node not found: ${rel.target}`);
                        return;
                      }
                      
                      db.run(
                        'INSERT OR REPLACE INTO node_relationships (source_node_id, target_node_id, relationship_type) VALUES (?, ?, ?)',
                        [sourceNode.id, targetNode.id, rel.type],
                        function(err) {
                          if (err) {
                            console.error(`Error inserting relationship ${rel.source} -> ${rel.target}:`, err.message);
                          } else {
                            relationshipsInserted++;
                            console.log(`Inserted relationship: ${rel.source} -> ${rel.target}`);
                          }
                          
                          // Check if all relationships are processed
                          if (relationshipsInserted === relationships.length) {
                            // Commit transaction
                            db.run('COMMIT;', (err) => {
                              if (err) {
                                console.error('Error committing transaction:', err.message);
                                db.run('ROLLBACK;');
                              } else {
                                console.log('Import completed successfully!');
                                console.log(`- Website: ${website.name}`);
                                console.log(`- Nodes: ${nodes.length}`);
                                console.log(`- Relationships: ${relationships.length}`);
                              }
                              
                              // Close database
                              db.close((err) => {
                                if (err) {
                                  console.error('Error closing database:', err.message);
                                } else {
                                  console.log('Database connection closed.');
                                }
                                process.exit(0);
                              });
                            });
                          }
                        }
                      );
                    });
                  });
                });
              }
            }
          );
        });
      }
    );
  });
}