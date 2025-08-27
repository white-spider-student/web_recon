import React, { useState, useEffect } from 'react';
import './App.css';
import { Graph } from './components/Graph';
import { DetailsPanel } from './components/DetailsPanel';
import axios from 'axios';

export default function App() {
  const [target, setTarget] = useState('target.com');
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [spacing, setSpacing] = useState(0.2);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedNodes, setHighlightedNodes] = useState([]); // array of node ids
  const [highlightPath, setHighlightPath] = useState([]); // array of node ids that form the path
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Filter state
  const [statusFilters, setStatusFilters] = useState({ '200': true, '403': true, '500': true });
  const [techFilters, setTechFilters] = useState({ 'React': true, 'WordPress': true, 'Laravel': true });
  // Visualization filters
  const [typeFilters, setTypeFilters] = useState({ root: true, subdomain: true, directory: true, endpoint: true, file: true });
  const [methodFilters, setMethodFilters] = useState({ GET: true, POST: true });
  const [fileTypeFilters, setFileTypeFilters] = useState({ Env: true, Text: true, XML: true, PHP: true, Hidden: true, Backup: true, SQL: true });

  // find shortest path between two node ids using BFS on the graph links
  const findShortestPath = (startId, endId) => {
    if (!graphData || !Array.isArray(graphData.nodes) || !Array.isArray(graphData.links)) return [];
    const adj = new Map();
    for (const n of graphData.nodes) adj.set(n.id, new Set());
    for (const l of graphData.links) {
      const a = typeof l.source === 'object' ? l.source.id : l.source;
      const b = typeof l.target === 'object' ? l.target.id : l.target;
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b);
      adj.get(b).add(a);
    }
    const q = [startId];
    const prev = new Map();
    prev.set(startId, null);
    let found = false;
    for (let i = 0; i < q.length && !found; i++) {
      const cur = q[i];
      const nbrs = adj.get(cur) || new Set();
      for (const nb of nbrs) {
        if (!prev.has(nb)) {
          prev.set(nb, cur);
          q.push(nb);
          if (nb === endId) { found = true; break; }
        }
      }
    }
    if (!prev.has(endId)) return [];
    // reconstruct path
    const path = [];
    let cur = endId;
    while (cur !== null) { path.push(cur); cur = prev.get(cur); }
    return path.reverse();
  };

  const handleSearch = (value) => {
    setSearchTerm(value);
    const q = String(value || '').trim();
    if (!q) {
      setHighlightedNodes([]);
      setHighlightPath([]);
      return;
    }

    // if user supplied two terms separated by comma or space, treat as two endpoints
    const parts = q.split(/[,\s]+/).filter(Boolean);
    const nodes = graphData.nodes || [];
    if (parts.length >= 2) {
      // produce candidate matches (exact first, then substring matches)
      const termMatches = (term) => {
        const t = term.toLowerCase();
        const exact = nodes.filter(n => n.id.toLowerCase() === t);
        if (exact.length) return exact;
        const subs = nodes.filter(n => n.id.toLowerCase().includes(t));
        return subs;
      };

      const candA = termMatches(parts[0]);
      const candB = termMatches(parts[1]);

      // set highlighted nodes to all candidates so user sees them
      const ids = Array.from(new Set([...(candA||[]).map(n=>n.id), ...(candB||[]).map(n=>n.id)]));
      setHighlightedNodes(ids);

      // try every pair of candidates to find the shortest connecting path
      let bestPath = null;
      if ((candA||[]).length && (candB||[]).length) {
        for (const aNode of candA) {
          for (const bNode of candB) {
            if (aNode.id === bNode.id) continue; // same node
            const p = findShortestPath(aNode.id, bNode.id);
            if (p && p.length) {
              if (!bestPath || p.length < bestPath.length) bestPath = p;
            }
          }
        }
      }

      if (bestPath) {
        setHighlightPath(bestPath);
      } else {
        setHighlightPath([]);
      }
      return;
    }

    // otherwise find all nodes that contain the query text
    const matches = nodes.filter(n => String(n.id).toLowerCase().includes(q.toLowerCase())).map(n => n.id);
    setHighlightedNodes(matches);

    // if exactly one match, compute path from domain root to it
    if (matches.length === 1) {
      const rootNode = (nodes.find(n => n.group === 'domain') || nodes[0]);
      if (rootNode) {
        const path = findShortestPath(rootNode.id, matches[0]);
        setHighlightPath(path);
      } else setHighlightPath([]);
    } else {
      setHighlightPath([]);
    }
  };

  const handleScan = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Fetch websites from the API
      const websitesResponse = await axios.get('http://localhost:3001/websites');
      const websites = websitesResponse.data;
      
      // If no websites exist, create a default one
      let websiteId = 1;
      if (websites.length === 0) {
        const newWebsiteResponse = await axios.post('http://localhost:3001/websites', {
          url: target || 'example.com',
          name: target || 'Example Website'
        });
        websiteId = newWebsiteResponse.data.id;
      } else {
        websiteId = websites[0].id;
      }
      
      // Fetch nodes for the website
      const nodesResponse = await axios.get(`http://localhost:3001/websites/${websiteId}/nodes`);
      const nodes = nodesResponse.data;
      
      // Transform nodes to match the expected format
      const transformedNodes = nodes.map(node => ({
        id: node.node_id,
        group: node.group_name || node.type,
        type: node.type,
        status: node.status,
        method: node.method,
        fileType: node.file_type,
        desc: node.description,
        responseSize: node.response_size,
        headers: node.headers || [],
        technologies: node.technologies || [],
        vulnerabilities: node.vulnerabilities || []
      }));
      
      // Create some dummy links for visualization since the database likely doesn't have relationships yet
      const links = [];
      if (transformedNodes.length > 1) {
        for (let i = 0; i < transformedNodes.length - 1; i++) {
          links.push({
            source: transformedNodes[i].id,
            target: transformedNodes[i + 1].id
          });
        }
      }
      
      setGraphData({ nodes: transformedNodes, links });
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to fetch data from the server');
    } finally {
      setLoading(false);
    }
  };

  // Load data from the database on first render
  React.useEffect(() => {
    handleScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app-shell">
      <div className="sidebar" style={{ background: '#0a151c', color: '#d6e6ea', width: 220, minHeight: '100vh', padding: '24px 18px 12px 18px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 0 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#2de2e6', marginBottom: 18, letterSpacing: 1 }}>WEB RECON</h1>
        <div style={{ marginBottom: 12 }}>
          <input
            type="text"
            placeholder="target.com"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', background: '#10151c', color: '#2de2e6', border: '1px solid #232b36', borderRadius: 6, fontSize: 15, marginBottom: 6 }}
          />
        </div>
        <button onClick={handleScan} disabled={loading} style={{ width: '100%', background: loading ? '#1a5e63' : '#2de2e6', color: '#042426', fontWeight: 600, fontSize: 16, border: 'none', borderRadius: 7, padding: '10px 0', marginBottom: 22, boxShadow: '0 2px 8px rgba(45,226,230,0.12)', cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? 'Scanning...' : 'Start Scan'}
        </button>
        {error && (
          <div style={{ color: '#ff6b6b', marginBottom: 22, padding: '10px', background: 'rgba(255,107,107,0.1)', borderRadius: 6 }}>
            {error}
          </div>
        )}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, color: '#9aa6b0', marginBottom: 6 }}>Progress</div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>0 subdomains</span><span>65%</span></div>
            <div style={{ height: 4, background: '#232b36', borderRadius: 2 }}><div style={{ width: '65%', height: 4, background: '#2de2e6', borderRadius: 2 }} /></div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>10 directories</span><span>33%</span></div>
            <div style={{ height: 4, background: '#232b36', borderRadius: 2 }}><div style={{ width: '33%', height: 4, background: '#3b82f6', borderRadius: 2 }} /></div>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>35 endpoints</span><span>16%</span></div>
            <div style={{ height: 4, background: '#232b36', borderRadius: 2 }}><div style={{ width: '16%', height: 4, background: '#fb923c', borderRadius: 2 }} /></div>
          </div>
        </div>
        <div style={{ fontSize: 15, color: '#d6e6ea', marginBottom: 8, fontWeight: 600 }}>Filters</div>
        <div style={{ maxHeight: '260px', overflowY: 'auto', marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: '#9aa6b0', marginBottom: 6, fontWeight: 500 }}>Status Code</div>
          {['200', '403', '500'].map(code => (
            <label key={code} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, marginBottom: 2 }}>
              <input type="checkbox" checked={statusFilters[code]} onChange={e => setStatusFilters(f => ({ ...f, [code]: e.target.checked }))} style={{ accentColor: '#2de2e6', marginRight: 4 }} /> {code}
            </label>
          ))}
          <div style={{ fontSize: 13, color: '#9aa6b0', marginBottom: 6, marginTop: 10, fontWeight: 500 }}>Technology</div>
          {Object.keys(techFilters).map(tech => (
            <label key={tech} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, marginBottom: 2 }}>
              <input type="checkbox" checked={techFilters[tech]} onChange={e => setTechFilters(f => ({ ...f, [tech]: e.target.checked }))} style={{ accentColor: '#2de2e6', marginRight: 4 }} /> {tech}
            </label>
          ))}
          <div style={{ fontSize: 13, color: '#9aa6b0', marginBottom: 6, marginTop: 10, fontWeight: 500 }}>Type</div>
          {Object.keys(typeFilters).map(type => (
            <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, marginBottom: 2 }}>
              <input type="checkbox" checked={typeFilters[type]} onChange={e => setTypeFilters(f => ({ ...f, [type]: e.target.checked }))} style={{ accentColor: '#2de2e6', marginRight: 4 }} /> {type}
            </label>
          ))}
          <div style={{ fontSize: 13, color: '#9aa6b0', marginBottom: 6, marginTop: 10, fontWeight: 500 }}>Method</div>
          {Object.keys(methodFilters).map(method => (
            <label key={method} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, marginBottom: 2 }}>
              <input type="checkbox" checked={methodFilters[method]} onChange={e => setMethodFilters(f => ({ ...f, [method]: e.target.checked }))} style={{ accentColor: '#2de2e6', marginRight: 4 }} /> {method}
            </label>
          ))}
          <div style={{ fontSize: 13, color: '#9aa6b0', marginBottom: 6, marginTop: 10, fontWeight: 500 }}>File Type</div>
          {Object.keys(fileTypeFilters).map(ftype => (
            <label key={ftype} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, marginBottom: 2 }}>
              <input type="checkbox" checked={fileTypeFilters[ftype]} onChange={e => setFileTypeFilters(f => ({ ...f, [ftype]: e.target.checked }))} style={{ accentColor: '#2de2e6', marginRight: 4 }} /> {ftype}
            </label>
          ))}
        </div>
        <div style={{ marginTop: 'auto' }}>
          <input value={searchTerm} onChange={(e) => handleSearch(e.target.value)} type="text" placeholder="Search" style={{ width: '100%', padding: 8, background: '#10151c', color: '#2de2e6', border: '1px solid #232b36', borderRadius: 6, fontSize: 15 }} />
        </div>
      </div>

      <div className="main-content">
        <div className="graph-area" style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', position: 'relative' }}>
          <div style={{ flex: 1, position: 'relative', width: '100%', height: '100%', minHeight: 0 }}>
            <Graph
              data={(function() {
                // ...existing code...
                const visibleNodes = graphData.nodes.filter(n => {
                  let status = n.status || (String(n.id || '').includes('adm') ? '403' : '200');
                  status = String(status).replace(/[^0-9]/g, '');
                  if (!statusFilters[status]) return false;
                  if (n.type && !typeFilters[n.type]) return false;
                  if (n.method && !methodFilters[n.method]) return false;
                  if (n.fileType && !fileTypeFilters[n.fileType]) return false;
                  return true;
                });
                const visibleIds = new Set(visibleNodes.map(n => n.id));
                const visibleLinks = graphData.links.filter(l => {
                  const a = typeof l.source === 'object' ? l.source.id : l.source;
                  const b = typeof l.target === 'object' ? l.target.id : l.target;
                  return visibleIds.has(a) && visibleIds.has(b);
                });
                return {
                  ...graphData,
                  nodes: visibleNodes,
                  links: visibleLinks
                };
              })()}
              spacing={spacing}
              highlightedNodes={highlightedNodes}
              highlightPath={highlightPath}
              onNodeClick={(node, highlightIds) => {
                setSelectedNode(node);
                setHighlightedNodes(highlightIds || [node.id]);
                if (window && window.graphInstance && node) {
                  // graphInstance is set in Graph.jsx, see below
                  window.graphInstance.zoomToNode(node.id, 5.0, 1200);
                }
              }}
            />
            {/* right-hand details panel overlays graph area */}
            <div className={selectedNode ? 'details-panel' : 'details-panel hidden'}>
              {selectedNode && <DetailsPanel node={selectedNode} onClose={() => setSelectedNode(null)} />}
            </div>
          </div>
          {/* Color example legend overlays at bottom of graph area */}
          <div className="legend">
            <div><span className="subdomains" style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', background: '#2de2e6', marginRight: 8 }} /> Subdomains</div>
            <div><span className="directories" style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', background: '#3b82f6', marginRight: 8 }} /> Directories</div>
            <div><span className="endpoints" style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', background: '#fb923c', marginRight: 8 }} /> Endpoints</div>
          </div>
        </div>
      </div>
    </div>
  );
}
