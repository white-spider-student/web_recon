const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Read the JSON file
const reconData = require('./example-recon.json');

// Connect to SQLite database
const db = new sqlite3.Database('./data.db');

// Insert data
db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    // Insert website
    db.run(`INSERT INTO websites (url, name) VALUES (?, ?)`, 
        [reconData.domain, reconData.domain],
        function(err) {
            if (err) {
                console.error('Error inserting website:', err);
                db.run('ROLLBACK');
                return;
            }

            const websiteId = this.lastID;
            console.log('Website inserted with ID:', websiteId);

            // Insert nodes and collect their IDs
            const nodeIds = new Map();

            // Prepare statements
            const nodeStmt = db.prepare(`
                INSERT INTO nodes (website_id, value, type, status, size)
                VALUES (?, ?, ?, ?, ?)
            `);

            const headerStmt = db.prepare(`
                INSERT INTO node_headers (node_id, header_key, header_value)
                VALUES (?, ?, ?)
            `);

            const techStmt = db.prepare(`
                INSERT INTO node_technologies (node_id, technology)
                VALUES (?, ?)
            `);

            const vulnStmt = db.prepare(`
                INSERT INTO node_vulnerabilities (node_id, vulnerability)
                VALUES (?, ?)
            `);

            const relStmt = db.prepare(`
                INSERT INTO node_relationships (source_node_id, target_node_id, relationship_type)
                VALUES (?, ?, ?)
            `);

            // Insert nodes first
            reconData.nodes.forEach(node => {
                nodeStmt.run(
                    websiteId,
                    node.value || node.label,
                    node.type,
                    node.status || 200,
                    node.size || 0,
                    function(err) {
                        if (err) {
                            console.error('Error inserting node:', err);
                            return;
                        }

                        const nodeId = this.lastID;
                        nodeIds.set(node.value || node.label, nodeId);

                        // Insert headers
                        if (node.headers) {
                            node.headers.forEach(header => {
                                headerStmt.run(nodeId, header.key || header.name, header.value);
                            });
                        }

                        // Insert technologies
                        if (node.technologies) {
                            node.technologies.forEach(tech => {
                                techStmt.run(nodeId, tech);
                            });
                        }

                        // Insert vulnerabilities
                        if (node.vulnerabilities) {
                            node.vulnerabilities.forEach(vuln => {
                                vulnStmt.run(nodeId, typeof vuln === 'string' ? vuln : vuln.type);
                            });
                        }
                    }
                );
            });

            // Insert relationships
            reconData.relationships.forEach(rel => {
                const sourceId = nodeIds.get(rel.source === "1" ? reconData.domain : rel.source);
                const targetId = nodeIds.get(rel.target);
                if (sourceId && targetId) {
                    relStmt.run(sourceId, targetId, rel.type);
                }
            });

            // Finalize all statements
            nodeStmt.finalize();
            headerStmt.finalize();
            techStmt.finalize();
            vulnStmt.finalize();
            relStmt.finalize();

            // Commit transaction
            db.run('COMMIT', err => {
                if (err) {
                    console.error('Error committing transaction:', err);
                    db.run('ROLLBACK');
                } else {
                    console.log('All data inserted successfully!');
                }
            });
        }
    );
});
