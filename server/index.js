const fs = require('fs');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(bodyParser.json());
app.use(cors());

// Open DB
const db = new sqlite3.Database(path.join(__dirname, 'data.db'), (err) => {
  if (err) {
    console.error('Failed to open DB:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database.');
  ensureSchema();
  // Ensure nodes table has the meta columns we expect, then detect header/tech column names
  ensureNodeColumns(() => detectSchemaColumns());
});

// Detected column names (default to common names)
let headerKeyCol = 'header_key';
let headerValueCol = 'header_value';
let techCol = 'technology';

function detectSchemaColumns() {
  // Inspect node_headers
  db.all("PRAGMA table_info('node_headers')", (err, cols) => {
    if (!err && Array.isArray(cols)) {
      const names = cols.map(c => c.name);
      if (!names.includes('header_key') && names.includes('name')) headerKeyCol = 'name';
      if (!names.includes('header_value') && names.includes('value')) headerValueCol = 'value';
    }
  });

  // Inspect node_technologies
  db.all("PRAGMA table_info('node_technologies')", (err, cols) => {
    if (!err && Array.isArray(cols)) {
      const names = cols.map(c => c.name);
      if (!names.includes('technology') && names.includes('name')) techCol = 'name';
    }
  });
}

function ensureSchema() {
  // Create websites table
  db.run(`CREATE TABLE IF NOT EXISTS websites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE,
    name TEXT
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

  // Create node_headers (use canonical columns)
  db.run(`CREATE TABLE IF NOT EXISTS node_headers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL,
    header_key TEXT,
    header_value TEXT,
    name TEXT,
    value TEXT,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
  )`);

  // Create node_technologies
  db.run(`CREATE TABLE IF NOT EXISTS node_technologies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL,
    technology TEXT,
    name TEXT,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
  )`);

  // Create node_vulnerabilities
  db.run(`CREATE TABLE IF NOT EXISTS node_vulnerabilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL,
    vulnerability TEXT,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
  )`);

  // Create node_relationships
  db.run(`CREATE TABLE IF NOT EXISTS node_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_node_id INTEGER NOT NULL,
    target_node_id INTEGER NOT NULL,
    relationship_type TEXT,
    FOREIGN KEY (source_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    UNIQUE(source_node_id, target_node_id)
  )`);

  // Indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_nodes_website_id ON nodes(website_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_nodes_value ON nodes(value)');
}

// Ensure optional meta columns exist on nodes table (safe ALTER TABLE)
function ensureNodeColumns(cb) {
  db.all("PRAGMA table_info('nodes')", (err, cols) => {
    if (err || !Array.isArray(cols)) return cb && cb();
    const names = cols.map(c => c.name);
    const adds = [];
    if (!names.includes('ip')) adds.push('ip TEXT');
    if (!names.includes('response_time_ms')) adds.push('response_time_ms REAL');
    if (!names.includes('title')) adds.push('title TEXT');
    if (!names.includes('ports')) adds.push('ports TEXT');
    if (!names.includes('tls_cert')) adds.push('tls_cert TEXT');
    if (!names.includes('dirsearch_count')) adds.push('dirsearch_count INTEGER');
    if (!names.includes('wappalyzer')) adds.push('wappalyzer TEXT');

    if (adds.length === 0) {
      return cb && cb();
    }

    // Add columns sequentially to avoid SQLITE_BUSY issues
    let i = 0;
    const next = () => {
      if (i >= adds.length) return cb && cb();
      const sql = `ALTER TABLE nodes ADD COLUMN ${adds[i]}`;
      db.run(sql, (aErr) => {
        if (aErr && !/duplicate column/i.test(aErr.message)) console.error('Error adding column to nodes:', aErr.message);
        i++; next();
      });
    };
    next();
  });
}

// API Endpoints

// Get all websites
app.get('/websites', (req, res) => {
  db.all('SELECT * FROM websites', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Create a new website
app.post('/websites', (req, res) => {
  const { url, name } = req.body;
  db.run('INSERT INTO websites (url, name) VALUES (?, ?)', [url, name], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: this.lastID, url, name });
  });
});

// Get all nodes for a specific website
app.get('/websites/:websiteId/nodes', async (req, res) => {
  const { websiteId } = req.params;
  try {
    const nodesQuery = `SELECT id, value, type, status, size FROM nodes WHERE website_id = ?`;
    const rawNodes = await new Promise((resolve, reject) => {
      db.all(nodesQuery, [websiteId], (err, rows) => err ? reject(err) : resolve(rows));
    });

    // Build nodes with headers and technologies using detected column names
    const nodes = await Promise.all(rawNodes.map(async (row) => {
      const node = {
        id: row.value,
        group: row.type || 'unknown',
        type: row.type || 'unknown',
        value: row.value,
        status: row.status,
        size: row.size,
  meta: {}
      };

      // headers
      const hQuery = `SELECT ${headerKeyCol} as keycol, ${headerValueCol} as valcol FROM node_headers WHERE node_id = ?`;
      const headers = await new Promise((resolve) => {
        db.all(hQuery, [row.id], (hErr, hRows) => {
          if (hErr) {
            console.error('Error loading headers for node', row.id, hErr.message);
            return resolve([]);
          }
          resolve(hRows || []);
        });
      });
      node.meta.headers = {};
      node.headers = [];
      headers.forEach(h => {
        if (h.keycol != null) node.meta.headers[String(h.keycol)] = h.valcol == null ? '' : String(h.valcol);
        node.headers.push({ key: h.keycol, value: h.valcol });
      });

      // technologies
      const tQuery = `SELECT ${techCol} as techcol FROM node_technologies WHERE node_id = ?`;
      const techs = await new Promise((resolve) => {
        db.all(tQuery, [row.id], (tErr, tRows) => {
          if (tErr) {
            console.error('Error loading technologies for node', row.id, tErr.message);
            return resolve([]);
          }
          resolve((tRows || []).map(r => r.techcol));
        });
      });
      node.meta.technologies = techs;
      node.technologies = techs;

      // attach persisted meta columns if present on row
      try {
        if (row.ip) node.meta.ip = row.ip;
        if (row.response_time_ms != null) node.meta.response_time_ms = row.response_time_ms;
        if (row.title) node.meta.title = row.title;
        if (row.dirsearch_count != null) node.meta.dirsearch_count = row.dirsearch_count;
        if (row.ports) {
          try { node.meta.ports = JSON.parse(row.ports); } catch (e) { node.meta.ports = Array.isArray(row.ports) ? row.ports : [row.ports]; }
        }
        if (row.tls_cert) {
          try { node.meta.tls_cert = JSON.parse(row.tls_cert); } catch (e) { node.meta.tls_cert = row.tls_cert; }
        }
        if (row.wappalyzer) {
          try { node.meta.wappalyzer = JSON.parse(row.wappalyzer); } catch (e) { node.meta.wappalyzer = row.wappalyzer; }
        }
      } catch (e) { /* ignore */ }

      // Backwards-compat: some imports store a JSON blob in `details` column. Merge it into node.meta
      if (row.details) {
        try {
          const details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
          if (details && typeof details === 'object') {
            // shallow merge, don't overwrite explicit columns already set above
            for (const k of Object.keys(details)) {
              if (node.meta[k] === undefined) node.meta[k] = details[k];
            }
          }
        } catch (e) {
          // ignore malformed JSON
        }
      }

      return node;
    }));

    // Relationships
    const relationshipsQuery = `
      SELECT (SELECT value FROM nodes WHERE id = nr.source_node_id) as source,
             (SELECT value FROM nodes WHERE id = nr.target_node_id) as target,
             relationship_type as type
      FROM node_relationships nr
      WHERE EXISTS (SELECT 1 FROM nodes WHERE nodes.id = nr.source_node_id AND nodes.website_id = ?)
    `;
    const relationships = await new Promise((resolve, reject) => {
      db.all(relationshipsQuery, [websiteId], (err, rows) => err ? reject(err) : resolve((rows || []).map(rel => ({ source: rel.source, target: rel.target, type: rel.type || 'contains' }))));
    });

    res.json({ nodes, relationships });
  } catch (err) {
    console.error('Error fetching nodes:', err.message);
    res.status(500).json({ error: 'Failed to fetch graph data', details: err.message });
  }
});

// Serve raw viz JSON file (results/clean/<website>_viz.json) so frontend can fetch the original file
app.get('/websites/:websiteId/viz', (req, res) => {
  const websiteId = req.params.websiteId;
  db.get('SELECT url FROM websites WHERE id = ? LIMIT 1', [websiteId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row || !row.url) return res.status(404).json({ error: 'Website not found' });
    const vizPath = path.resolve(__dirname, '..', 'results', 'clean', `${row.url}_viz.json`);
    fs.readFile(vizPath, 'utf8', (rErr, data) => {
      if (rErr) return res.status(404).json({ error: 'Viz file not found', path: vizPath });
      try {
        const parsed = JSON.parse(data);
        res.json(parsed);
      } catch (e) {
        // if file is not valid JSON, return raw text
        res.type('text').send(data);
      }
    });
  });
});

// Get a single node (by node value/id) for a specific website
app.get('/websites/:websiteId/nodes/:nodeId', async (req, res) => {
  const { websiteId, nodeId } = req.params;
  try {
    const nodeRow = await new Promise((resolve, reject) => {
      db.get('SELECT id, value, type, status, size FROM nodes WHERE website_id = ? AND value = ? LIMIT 1', [websiteId, nodeId], (err, row) => err ? reject(err) : resolve(row));
    });
    if (!nodeRow) return res.status(404).json({ error: 'Node not found' });

    const node = {
      id: nodeRow.value,
      group: nodeRow.type || 'unknown',
      type: nodeRow.type || 'unknown',
      value: nodeRow.value,
      status: nodeRow.status,
      size: nodeRow.size,
  meta: {}
    };

    const hQuery = `SELECT ${headerKeyCol} as keycol, ${headerValueCol} as valcol FROM node_headers WHERE node_id = ?`;
    const headers = await new Promise((resolve) => {
      db.all(hQuery, [nodeRow.id], (hErr, hRows) => {
        if (hErr) {
          console.error('Error loading headers for node', nodeRow.id, hErr.message);
          return resolve([]);
        }
        resolve(hRows || []);
      });
    });
    node.meta.headers = {};
    node.headers = [];
    headers.forEach(h => {
      if (h.keycol != null) node.meta.headers[String(h.keycol)] = h.valcol == null ? '' : String(h.valcol);
      node.headers.push({ key: h.keycol, value: h.valcol });
    });

    const tQuery = `SELECT ${techCol} as techcol FROM node_technologies WHERE node_id = ?`;
    const techs = await new Promise((resolve) => {
      db.all(tQuery, [nodeRow.id], (tErr, tRows) => {
        if (tErr) {
          console.error('Error loading technologies for node', nodeRow.id, tErr.message);
          return resolve([]);
        }
        resolve((tRows || []).map(r => r.techcol));
      });
    });
    node.meta.technologies = techs;
    node.technologies = techs;

    // attach stored meta columns from nodes table (if present)
    try {
      if (nodeRow.ip) node.meta.ip = nodeRow.ip;
      if (nodeRow.response_time_ms != null) node.meta.response_time_ms = nodeRow.response_time_ms;
      if (nodeRow.title) node.meta.title = nodeRow.title;
      if (nodeRow.dirsearch_count != null) node.meta.dirsearch_count = nodeRow.dirsearch_count;
      if (nodeRow.ports) {
        try { node.meta.ports = JSON.parse(nodeRow.ports); } catch (e) { node.meta.ports = Array.isArray(nodeRow.ports) ? nodeRow.ports : [nodeRow.ports]; }
      }
      if (nodeRow.tls_cert) {
        try { node.meta.tls_cert = JSON.parse(nodeRow.tls_cert); } catch (e) { node.meta.tls_cert = nodeRow.tls_cert; }
      }
      if (nodeRow.wappalyzer) {
        try { node.meta.wappalyzer = JSON.parse(nodeRow.wappalyzer); } catch (e) { node.meta.wappalyzer = nodeRow.wappalyzer; }
      }
    } catch (e) { /* ignore */ }

    // Backwards-compat: merge legacy `details` JSON blob if present
    if (nodeRow.details) {
      try {
        const details = typeof nodeRow.details === 'string' ? JSON.parse(nodeRow.details) : nodeRow.details;
        if (details && typeof details === 'object') {
          for (const k of Object.keys(details)) {
            if (node.meta[k] === undefined) node.meta[k] = details[k];
          }
        }
      } catch (e) { /* ignore malformed details */ }
    }

    res.json({ node });
  } catch (err) {
    console.error('Error fetching node:', err.message);
    res.status(500).json({ error: 'Failed to fetch node', details: err.message });
  }
});

// Get all nodes (across all websites)
app.get('/nodes', (req, res) => {
  const query = `
    SELECT n.*, w.url as website_url
    FROM nodes n
    LEFT JOIN websites w ON n.website_id = w.id
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Save new node data (simple endpoint)
app.post('/websites/:websiteId/nodes', (req, res) => {
  const websiteId = req.params.websiteId;
  const { nodeId, type, status, size, headers, technologies, vulnerabilities } = req.body;
  db.serialize(() => {
    db.run('BEGIN TRANSACTION;');
    db.run('INSERT INTO nodes (website_id, value, type, status, size) VALUES (?, ?, ?, ?, ?)', [websiteId, nodeId, type, status, size], function (err) {
      if (err) { db.run('ROLLBACK;'); return res.status(500).json({ error: err.message }); }
      const newNodeId = this.lastID;
      if (Array.isArray(headers)) {
        const headerCols = `${headerKeyCol}, ${headerValueCol}`;
        const headerQuery = `INSERT INTO node_headers (node_id, ${headerCols}) VALUES (?, ?, ?)`;
        headers.forEach(h => db.run(headerQuery, [newNodeId, h.key, h.value], (e) => { if (e) console.error('Header insert error', e.message); }));
      }
      if (Array.isArray(technologies)) {
        const techQuery = `INSERT INTO node_technologies (node_id, ${techCol}) VALUES (?, ?)`;
        technologies.forEach(t => db.run(techQuery, [newNodeId, t], (e) => { if (e) console.error('Tech insert error', e.message); }));
      }
      if (Array.isArray(vulnerabilities)) {
        const vulnQuery = `INSERT INTO node_vulnerabilities (node_id, vulnerability) VALUES (?, ?)`;
        vulnerabilities.forEach(v => db.run(vulnQuery, [newNodeId, v], (e) => { if (e) console.error('Vuln insert error', e.message); }));
      }
      db.run('COMMIT;', (cErr) => { if (cErr) { db.run('ROLLBACK;'); return res.status(500).json({ error: cErr.message }); } return res.status(201).json({ id: newNodeId }); });
    });
  });
});

// Create a relationship between two nodes
app.post('/nodes/:sourceNodeId/relationships/:targetNodeId', (req, res) => {
  const sourceNodeId = req.params.sourceNodeId;
  const targetNodeId = req.params.targetNodeId;
  const { relationshipType } = req.body;
  db.run('INSERT INTO node_relationships (source_node_id, target_node_id, relationship_type) VALUES (?, ?, ?)', [sourceNodeId, targetNodeId, relationshipType], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: this.lastID, sourceNodeId, targetNodeId, relationshipType });
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
