const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Read the JSON file
const reconData = require('./example-recon.json');

// Connect to SQLite database
const db = new sqlite3.Database('./data.db');

// Begin transaction
db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    try {
        // Insert website
        db.run(
            'INSERT INTO websites (url, name) VALUES (?, ?)',
            [reconData.domain, reconData.domain],
            function(err) {
                if (err) throw err;
                const websiteId = this.lastID;

                // Insert nodes and track their IDs
                const nodeIds = new Map();

                // Process each node
                reconData.nodes.forEach(node => {
                    // Insert node
                    db.run(
                        'INSERT INTO nodes (website_id, type, value, status, size, details) VALUES (?, ?, ?, ?, ?, ?)',
                        [
                            websiteId,
                            node.type,
                            node.value || node.label,
                            node.status || 200,
                            node.size || 0,
                            JSON.stringify(node.details || {})
                        ],
                        function(err) {
                            if (err) throw err;
                            const nodeId = this.lastID;
                            nodeIds.set(node.value || node.label, nodeId);

                            // Insert headers
                            if (node.headers && node.headers.length > 0) {
                                node.headers.forEach(header => {
                                    db.run(
                                        'INSERT INTO node_headers (node_id, name, value) VALUES (?, ?, ?)',
                                        [nodeId, header.name || header.key, header.value]
                                    );
                                });
                            }

                            // Insert technologies
                            if (node.technologies && node.technologies.length > 0) {
                                node.technologies.forEach(tech => {
                                    db.run(
                                        'INSERT INTO node_technologies (node_id, name) VALUES (?, ?)',
                                        [nodeId, tech]
                                    );
                                });
                            }

                            // Insert vulnerabilities
                            if (node.vulnerabilities && node.vulnerabilities.length > 0) {
                                node.vulnerabilities.forEach(vuln => {
                                    const vulnText = typeof vuln === 'string' ? vuln : vuln.description || vuln.type;
                                    db.run(
                                        'INSERT INTO node_vulnerabilities (node_id, description) VALUES (?, ?)',
                                        [nodeId, vulnText]
                                    );
                                });
                            }
                        }
                    );
                });

                // Insert relationships after all nodes are inserted
                setTimeout(() => {
                    reconData.relationships.forEach(rel => {
                        const sourceId = nodeIds.get(rel.source === "1" ? reconData.domain : rel.source);
                        const targetId = nodeIds.get(rel.target);
                        if (sourceId && targetId) {
                            db.run(
                                'INSERT INTO node_relationships (source_node_id, target_node_id, relationship_type) VALUES (?, ?, ?)',
                                [sourceId, targetId, rel.type]
                            );
                        }
                    });

                    // Commit transaction
                    db.run('COMMIT', err => {
                        if (err) {
                            console.error('Error committing transaction:', err);
                            db.run('ROLLBACK');
                        } else {
                            console.log('Data inserted successfully!');
                        }
                        db.close();
                    });
                }, 1000);
            }
        );
    } catch (error) {
        console.error('Error during data insertion:', error);
        db.run('ROLLBACK');
        db.close();
    }
});
