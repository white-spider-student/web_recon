import React, { useState, useEffect } from 'react';
import './App.css';
import { HierarchicalGraph } from './components/HierarchicalGraph';
import { DetailsPanel } from './components/DetailsPanel';
import axios from 'axios';

export default function App() {
  const [target, setTarget] = useState('waitbutwhy.com');
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [currentWebsiteId, setCurrentWebsiteId] = useState(null);
  const [spacing, setSpacing] = useState(0.2);
  const [levelNumber, setLevelNumber] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedNodes, setHighlightedNodes] = useState([]); // array of node ids
  const [highlightPath, setHighlightPath] = useState([]); // array of node ids that form the path
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Filter state
  const [statusFilters, setStatusFilters] = useState({ '200': true, '403': true, '500': true });
  const [techFilters, setTechFilters] = useState({ 'React': true, 'WordPress': true, 'Laravel': true });
  // Visualization filters
  const [typeFilters, setTypeFilters] = useState({ 
    domain: true, 
    subdomain: true, 
    directory: true, 
    endpoint: true, 
    file: true 
  });
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

  // Expand graph up to a specific depth level (0 = root only, 1 = root + immediate children, etc.)
  const expandToLevel = async (level) => {
    const gi = window.graphInstance;
    if (!gi) return console.error('graphInstance not available');

    // Prefer the centralized expandToLevel API implemented by the graph component.
    if (typeof gi.expandToLevel === 'function') {
      try {
        gi.expandToLevel(level);
        return;
      } catch (e) {
        console.debug('expandToLevel API failed, falling back to iterative expansion', e);
      }
    }

    // Fallback: iterative expansion using expandNode/collapseAll if expandToLevel not available
    const nodes = graphData.nodes || [];
    const links = graphData.links || [];
    const root = nodes.find(n => n.type === 'domain') || nodes[0];
    if (!root) return console.error('No root node');

    // Collapse all then expand root
    gi.collapseAll && gi.collapseAll();
    gi.expandNode && gi.expandNode(root.id);
    if (level <= 0) return;
    // Current frontier holds nodes at current depth
    let frontier = [root.id];
    for (let depth = 1; depth <= level; depth++) {
      const next = [];
      for (const id of frontier) {
        // find immediate children in the raw graphData (contains links)
        const kids = links.filter(l => (typeof l.source === 'object' ? l.source.id : l.source) === id && l.type === 'contains').map(l => (typeof l.target === 'object' ? l.target.id : l.target));
        for (const k of kids) {
          gi.expandNode && gi.expandNode(k); // make the node visible
          next.push(k);
        }
      }
      frontier = [...new Set(next)];
      // small delay to let graph settle and to show progression
      await new Promise(r => setTimeout(r, 300));
      if (!frontier.length) break; // nothing more to expand
    }
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
      
      // Search for website by URL (case-insensitive)
      const targetUrl = target.trim().toLowerCase();
      let website = websites.find(w => w.url.toLowerCase() === targetUrl);
      let websiteId;
      
      if (!website) {
        // Website not found, create a new one
        const newWebsiteResponse = await axios.post('http://localhost:3001/websites', {
          url: target || 'example.com',
          name: target || 'Example Website'
        });
        websiteId = newWebsiteResponse.data.id;
        console.log(`Created new website: ${target}`);
      } else {
        // Website found, use its ID
        websiteId = website.id;
        console.log(`Found existing website: ${website.name} (ID: ${websiteId})`);
      }
      
      // Fetch nodes and relationships for the website
      const response = await axios.get(`http://localhost:3001/websites/${websiteId}/nodes`);
  const { nodes, relationships } = response.data;
  // remember current website id so we can lazy-load single node details later
  setCurrentWebsiteId(websiteId);
      
      console.log('=== DEBUG INFO ===');
      console.log('Website ID:', websiteId);
      console.log('Nodes received:', nodes.length);
      console.log('Relationships received:', relationships.length);
      console.log('Sample relationships:', relationships.slice(0, 3));
      
      // Normalize node types and transform nodes to the expected format
      // This helps avoid problems where backend uses variants like 'dir' or 'sub'
      // which the frontend layout expects as 'directory' / 'subdomain'.
      const normalizeType = (t) => {
        if (!t) return t;
        const s = String(t).toLowerCase();
        if (s === 'dir' || s === 'directory') return 'directory';
        if (s === 'sub' || s === 'subdomain') return 'subdomain';
        if (s === 'domain') return 'domain';
        if (s === 'endpoint' || s === 'ep') return 'endpoint';
        if (s === 'file') return 'file';
        // unknown types fall back to the original token (lowercased)
        return s;
      };

      // Preserve the full node object so DetailsPanel can access node.meta, headers, technologies etc.
      const transformedNodes = nodes.map(node => {
        const t = normalizeType(node.type || node.group);
        const id = node.id || node.value;
        return Object.assign({}, {
          id: id,
          group: t,
          type: t,
          value: node.value || id,
          status: node.status,
          size: node.size,
          label: node.value || id
        }, node);
      });

      // Transform relationships to match the expected format and ensure source/target are id strings
      const transformedLinks = relationships.map(rel => {
        const src = (rel.source && typeof rel.source === 'object') ? rel.source.id : rel.source;
        const tgt = (rel.target && typeof rel.target === 'object') ? rel.target.id : rel.target;
        return {
          source: String(src),
          target: String(tgt),
          type: rel.type || 'contains'
        };
      });
      
      console.log('Final graph data:', { 
        nodes: transformedNodes.length, 
        links: transformedLinks.length 
      });
      console.log('Sample links:', transformedLinks.slice(0, 3));
      console.log('=== END DEBUG ===');

      setGraphData({ nodes: transformedNodes, links: transformedLinks });
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
          {(function() {
            const nodes = graphData.nodes || [];
            const total = nodes.length || 1;
            const subdomains = nodes.filter(n => n.type === 'subdomain').length;
            const directories = nodes.filter(n => n.type === 'directory').length;
            const endpoints = nodes.filter(n => n.type === 'endpoint' || n.type === 'file').length;
            const p = (v) => Math.round((v / Math.max(1, total)) * 100);
            return (
              <>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{subdomains} subdomains</span><span>{p(subdomains)}%</span></div>
                  <div style={{ height: 4, background: '#232b36', borderRadius: 2 }}><div style={{ width: `${p(subdomains)}%`, height: 4, background: '#2de2e6', borderRadius: 2 }} /></div>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{directories} directories</span><span>{p(directories)}%</span></div>
                  <div style={{ height: 4, background: '#232b36', borderRadius: 2 }}><div style={{ width: `${p(directories)}%`, height: 4, background: '#3b82f6', borderRadius: 2 }} /></div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{endpoints} endpoints</span><span>{p(endpoints)}%</span></div>
                  <div style={{ height: 4, background: '#232b36', borderRadius: 2 }}><div style={{ width: `${p(endpoints)}%`, height: 4, background: '#fb923c', borderRadius: 2 }} /></div>
                </div>
              </>
            );
          })()}
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
            <HierarchicalGraph
              data={(function() {
                // Filter nodes based on current filter settings
                const visibleNodes = graphData.nodes.filter(n => {
                  // Get status from the node data
                  const status = String(n.status || '200').replace(/[^0-9]/g, '');
                  
                  // Check if this node should be visible based on filters
                  if (!statusFilters[status]) return false;
                  if (n.type && !typeFilters[n.type]) return false;
                  
                  return true;
                });
                
                // Get IDs of visible nodes
                const visibleIds = new Set(visibleNodes.map(n => n.id));
                
                // Filter links to only show connections between visible nodes
                const visibleLinks = graphData.links.filter(l => {
                  const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
                  const targetId = typeof l.target === 'object' ? l.target.id : l.target;
                  return visibleIds.has(sourceId) && visibleIds.has(targetId);
                });
                
                return {
                  nodes: visibleNodes,
                  links: visibleLinks
                };
              })()}
              spacing={spacing}
              highlightedNodes={highlightedNodes}
              highlightPath={highlightPath}
              onNodeClick={async (node, highlightIds) => {
                try {
                  if (currentWebsiteId) {
                    const encodedNodeId = encodeURIComponent(node.id);
                    const res = await axios.get(`http://localhost:3001/websites/${currentWebsiteId}/nodes/${encodedNodeId}`);
                    setSelectedNode(res.data.node || node);
                  } else {
                    setSelectedNode(node);
                  }
                } catch (e) {
                  console.error('Failed to fetch node details', e);
                  setSelectedNode(node);
                }

                setHighlightedNodes(highlightIds || [node.id]);
                if (window && window.graphInstance && node) {
                  // graphInstance is set in Graph.jsx, see below
                  window.graphInstance.zoomToNode(node.id, 5.0, 1200);
                }
              }}
            />
          </div>
        </div>
        {/* Details panel rendered alongside graph */}
        {selectedNode && (
          <DetailsPanel
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>
    </div>
  );
}
