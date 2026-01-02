import React, { useState, useEffect } from 'react';
import './App.css';
import { HierarchicalGraph } from './components/HierarchicalGraph';
import { TreeExplorer } from './components/TreeExplorer';
import { DetailsPanel } from './components/DetailsPanel';
import axios from 'axios';

const normalizeUrlParts = (input) => {
  if (!input) return null;
  let raw = String(input).trim();
  if (!raw) return null;
  raw = raw.replace(/#.*$/, '');
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw);
  let parsed;
  try {
    parsed = new URL(hasScheme ? raw : `http://${raw}`);
  } catch (e) {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase();
  let port = parsed.port;
  if ((parsed.protocol === 'http:' && port === '80') || (parsed.protocol === 'https:' && port === '443')) {
    port = '';
  }
  const host = port ? `${hostname}:${port}` : hostname;
  let path = parsed.pathname || '/';
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  const pathWithQuery = `${path}${parsed.search || ''}`;
  const pathSegments = path === '/' ? [] : path.split('/').filter(Boolean);
  return { host, hostname, port, pathSegments, path, pathWithQuery };
};

const getRootHostname = (hostname) => {
  if (!hostname) return hostname;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;
  if (hostname.includes(':')) return hostname;
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join('.');
};

const lastSegment = (path) => {
  if (path == null) return '/';
  let cleaned = String(path);
  cleaned = cleaned.replace(/[?#].*$/, '');
  if (cleaned.length > 1 && cleaned.endsWith('/')) cleaned = cleaned.slice(0, -1);
  const parts = cleaned.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '/';
};

const truncateLabel = (label) => {
  if (!label) return label;
  return label.length > 24 ? `${label.slice(0, 24)}…` : label;
};

const looksLikeFile = (segment) => {
  const idx = segment.lastIndexOf('.');
  return idx > 0 && idx < segment.length - 1;
};

const isAssetUrl = (value) => {
  if (!value) return false;
  const raw = String(value).toLowerCase();
  const path = raw.replace(/^https?:\/\/[^/]+/, '');
  const name = path.split('/').pop() || '';
  if (name === 'robots.txt' || name === 'sitemap.xml') return false;
  if (name.startsWith('favicon') || name.includes('apple-touch-icon') || name === 'manifest.json' || name === 'browserconfig.xml' || name === 'safari-pinned-tab.svg') return true;
  if (path.startsWith('/static/') || path.startsWith('/assets/') || path.startsWith('/images/') || path.startsWith('/img/') || path.startsWith('/fonts/') || path.startsWith('/cdn-cgi/')) return true;
  const ext = name.includes('.') ? name.split('.').pop() : '';
  if (['js','css','png','jpg','jpeg','gif','svg','ico','webp','woff','woff2','ttf','eot','map','mp4','webm','mp3','wav','pdf','zip','gz','tar','rar','7z','xml','txt','json'].includes(ext)) return true;
  return false;
};

const buildGraph = (urls) => {
  const nodeMap = new Map();
  const edgeMap = new Map();

  const addNode = (node) => {
    if (!nodeMap.has(node.id)) nodeMap.set(node.id, node);
  };

  const addEdge = (source, target) => {
    const key = `${source}->${target}`;
    if (!edgeMap.has(key)) edgeMap.set(key, { source, target, type: 'contains' });
  };

  urls.forEach((url) => {
    const parsed = normalizeUrlParts(url);
    if (!parsed) return;
    const { host, hostname, port, pathSegments, pathWithQuery } = parsed;
    if (!host) return;
    const rootHostname = getRootHostname(hostname);
    const rootHost = port ? `${rootHostname}:${port}` : rootHostname;
    const rootId = `host:${rootHost}`;
    addNode({
      id: rootId,
      type: 'host',
      role: 'root',
      label: truncateLabel(rootHostname),
      fullLabel: rootHost,
      hostname: rootHost,
      path: '/',
      level: 1
    });
    let parentId = rootId;
    const isSubdomain = rootHost !== host;
    if (isSubdomain) {
      const subdomainId = `host:${host}`;
      addNode({
        id: subdomainId,
        type: 'host',
        role: 'subdomain',
        label: truncateLabel(hostname),
        fullLabel: host,
        hostname: host,
        path: '/',
        level: 2
      });
      addEdge(rootId, subdomainId);
      parentId = subdomainId;
    }
    if (!pathSegments.length) {
      if (pathWithQuery && pathWithQuery !== '/') {
        const nodeId = `path:${host}:${pathWithQuery}`;
        addNode({
          id: nodeId,
          type: 'path',
          label: truncateLabel(pathWithQuery),
          fullLabel: pathWithQuery,
          hostname: host,
          path: pathWithQuery,
          level: isSubdomain ? 3 : 2
        });
        addEdge(parentId, nodeId);
      }
      return;
    }
    pathSegments.forEach((segment, index) => {
      const prefix = `/${pathSegments.slice(0, index + 1).join('/')}`;
      const nodeId = `path:${host}:${prefix}`;
      const isLast = index === pathSegments.length - 1;
      const nodeType = isLast && looksLikeFile(segment) ? 'file' : (isLast ? 'path' : 'dir');
      const baseLevel = isSubdomain ? 2 : 1;
      const shortLabel = lastSegment(prefix);
      const fullLabel = isLast && pathWithQuery ? pathWithQuery : prefix;
      addNode({
        id: nodeId,
        type: nodeType,
        label: truncateLabel(shortLabel),
        fullLabel,
        hostname: host,
        path: prefix,
        segment,
        level: baseLevel + index + 1
      });
      addEdge(parentId, nodeId);
      parentId = nodeId;
    });
  });

  return { nodes: Array.from(nodeMap.values()), edges: Array.from(edgeMap.values()) };
};

export default function App() {
  const [target, setTarget] = useState('');
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [currentWebsiteId, setCurrentWebsiteId] = useState(null);
  const [spacing, setSpacing] = useState(0.2);
  const [levelNumber, setLevelNumber] = useState(1);
  const [lazyGraphData, setLazyGraphData] = useState({ nodes: [], links: [] });
  const [viewMode, setViewMode] = useState('tree');
  const [fullGraphLoaded, setFullGraphLoaded] = useState(false);
  const [graphMode, setGraphMode] = useState('focus');
  const [focusDepth, setFocusDepth] = useState(1);
  const [maxGraphNodes, setMaxGraphNodes] = useState(80);
  const [hideUnrelated, setHideUnrelated] = useState(true);
  const [dirClusterThreshold, setDirClusterThreshold] = useState(20);
  const [urlClusterThreshold, setUrlClusterThreshold] = useState(50);
  const [expandedClusters, setExpandedClusters] = useState(new Set());
  const [lockLayout, setLockLayout] = useState(false);
  const [graphLayout, setGraphLayout] = useState('radial');
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedNodes, setHighlightedNodes] = useState([]); // array of node ids
  const [highlightPath, setHighlightPath] = useState([]); // array of node ids that form the path
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [scanProgress, setScanProgress] = useState(null);
  const [scanStatus, setScanStatus] = useState({ status: 'idle', stage: '', stageLabel: '', currentTarget: '', message: '', logTail: [], updatedAt: '', startedAt: '', stageMeta: {}, rootNode: null });
  const [showScanBanner, setShowScanBanner] = useState(false);
  const [scanPanelOpen, setScanPanelOpen] = useState(true);
  const [scanId, setScanId] = useState('');
  const [scanCancelling, setScanCancelling] = useState(false);
  const [scansOpen, setScansOpen] = useState(false);
  const [scansLoading, setScansLoading] = useState(false);
  const [scansError, setScansError] = useState('');
  const [scansList, setScansList] = useState([]);
  const [scansTotal, setScansTotal] = useState(0);
  const [scansOffset, setScansOffset] = useState(0);
  const [scansQuery, setScansQuery] = useState('');
  const [historyTab, setHistoryTab] = useState('domains');
  const [domainSummaries, setDomainSummaries] = useState([]);
  const [selectedDomain, setSelectedDomain] = useState('');
  const [domainScans, setDomainScans] = useState([]);
  const [domainOffset, setDomainOffset] = useState(0);
  // When details panel is closed, ensure graph uses full width
  useEffect(() => {
    try {
      if (typeof document !== 'undefined') {
        const value = selectedNode ? (getComputedStyle(document.documentElement).getPropertyValue('--details-panel-width') || '0px') : '0px';
        document.documentElement.style.setProperty('--details-panel-width', value);
      }
    } catch (e) {
      // ignore
    }
  }, [selectedNode]);

  // Filter state
  const [statusFilters, setStatusFilters] = useState({ '200': true, '403': true, '500': true });
  const [techFilters, setTechFilters] = useState({ 'React': true, 'WordPress': true, 'Laravel': true });
  // Visualization filters
  const [typeFilters, setTypeFilters] = useState({ 
    host: true, 
    dir: true, 
    path: true, 
    file: true 
  });
  const [methodFilters, setMethodFilters] = useState({ GET: true, POST: true });
  const [fileTypeFilters, setFileTypeFilters] = useState({ Env: true, Text: true, XML: true, PHP: true, Hidden: true, Backup: true, SQL: true });

  const formatLocalTime = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch (e) {
      return iso;
    }
  };

  const applyFiltersFromNodes = (nodes) => {
    const statuses = {};
    const techs = {};
    (nodes || []).forEach(n => {
      const code = String(n.status || '200').replace(/[^0-9]/g, '');
      if (code) statuses[code] = true;
      const tlist = n.technologies || n.meta?.technologies || [];
      if (Array.isArray(tlist)) {
        tlist.forEach(t => { if (t) techs[t] = true; });
      }
    });
    if (Object.keys(statuses).length) setStatusFilters(statuses);
    if (Object.keys(techs).length) setTechFilters(techs);
  };

  const buildGraphFromNodes = (nodes, websiteId) => {
    const transformedNodes = nodes.map(node => ({
      ...node,
      id: String(node.id),
      group: node.type,
      type: node.type,
      value: node.value,
      status: node.status,
      size: node.size,
      label: node.value
    }));

    const urlCandidates = transformedNodes
      .filter(n => {
        if (n.meta?.link_type && ['asset', 'feed'].includes(String(n.meta.link_type))) return false;
        const candidate = n.value || n.id;
        return candidate && !isAssetUrl(candidate);
      })
      .map(n => n.value || n.id)
      .filter(Boolean);

    const { nodes: graphNodes, edges } = buildGraph(urlCandidates);

    const metaByHostId = new Map();
    const metaByPathId = new Map();
    transformedNodes.forEach(n => {
      const parsed = normalizeUrlParts(n.value || n.id);
      if (!parsed) return;
      const { host, pathSegments } = parsed;
      if (!host) return;
      if (!pathSegments.length) {
        if (n.type === 'domain' || n.type === 'subdomain') {
          const hostId = `host:${host}`;
          if (!metaByHostId.has(hostId)) metaByHostId.set(hostId, n);
        }
        return;
      }
      const prefix = `/${pathSegments.join('/')}`;
      const pathId = `path:${host}:${prefix}`;
      if (!metaByPathId.has(pathId)) metaByPathId.set(pathId, n);
    });

    const enrichedNodes = graphNodes.map(n => {
      const meta = n.type === 'host' ? metaByHostId.get(n.id) : metaByPathId.get(n.id);
      if (!meta) return n;
      return {
        ...n,
        apiId: meta.id,
        status: meta.status,
        value: meta.value,
        fullLabel: meta.value || n.fullLabel,
        scan_started_at: meta.scan_started_at,
        scan_finished_at: meta.scan_finished_at,
        timestamp: meta.timestamp,
        meta: meta.meta,
        headers: meta.headers,
        technologies: meta.technologies,
        method: meta.method,
        file_type: meta.file_type,
        size: meta.size,
        vulns: meta.vulns
      };
    });

    setGraphData({ nodes: enrichedNodes, links: edges });
    setCurrentWebsiteId(websiteId);
    applyFiltersFromNodes(transformedNodes);
  };

  const buildFocusSubgraph = (data, startId, depth, maxNodes) => {
    if (!data?.nodes?.length || !data?.links?.length || !startId) {
      return { nodes: data?.nodes || [], links: data?.links || [] };
    }
    const nodeMap = new Map(data.nodes.map(n => [String(n.id), n]));
    const adj = new Map();
    data.links.forEach(l => {
      const src = String(typeof l.source === 'object' ? l.source.id : l.source);
      const tgt = String(typeof l.target === 'object' ? l.target.id : l.target);
      if (!adj.has(src)) adj.set(src, new Set());
      if (!adj.has(tgt)) adj.set(tgt, new Set());
      adj.get(src).add(tgt);
      adj.get(tgt).add(src);
    });
    const start = String(startId);
    const visited = new Set([start]);
    const queue = [{ id: start, d: 0 }];
    for (let i = 0; i < queue.length && visited.size < maxNodes; i++) {
      const { id, d } = queue[i];
      if (d >= depth) continue;
      const neighbors = adj.get(id) || new Set();
      for (const nb of neighbors) {
        if (visited.size >= maxNodes) break;
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push({ id: nb, d: d + 1 });
        }
      }
    }
    const nodes = Array.from(visited).map(id => nodeMap.get(id)).filter(Boolean);
    const idSet = new Set(nodes.map(n => String(n.id)));
    const links = data.links.filter(l => {
      const src = String(typeof l.source === 'object' ? l.source.id : l.source);
      const tgt = String(typeof l.target === 'object' ? l.target.id : l.target);
      return idSet.has(src) && idSet.has(tgt);
    });
    return { nodes, links };
  };

  const buildClusteredGraph = (data) => {
    if (!data?.nodes?.length || !data?.links?.length) return data;
    const nodeMap = new Map(data.nodes.map(n => [String(n.id), n]));
    const childrenByParent = new Map();
    data.links.forEach(l => {
      if (l.type !== 'contains') return;
      const src = String(typeof l.source === 'object' ? l.source.id : l.source);
      const tgt = String(typeof l.target === 'object' ? l.target.id : l.target);
      if (!childrenByParent.has(src)) childrenByParent.set(src, []);
      childrenByParent.get(src).push(tgt);
    });

    const hiddenNodes = new Set();
    const hiddenLinks = new Set();
    const clusterNodes = [];
    const clusterLinks = [];

    childrenByParent.forEach((childIds, parentId) => {
      const dirKids = childIds.filter(id => nodeMap.get(id)?.type === 'dir');
      const urlKids = childIds.filter(id => {
        const t = nodeMap.get(id)?.type;
        return t === 'path' || t === 'file';
      });
      if (dirKids.length > dirClusterThreshold) {
        const clusterId = `cluster:${parentId}:dir`;
        if (!expandedClusters.has(clusterId)) {
          dirKids.forEach(id => hiddenNodes.add(id));
          dirKids.forEach(id => hiddenLinks.add(`${parentId}->${id}`));
          clusterNodes.push({
            id: clusterId,
            label: `Directories (${dirKids.length})`,
            type: 'cluster',
            clusterType: 'directory',
            count: dirKids.length,
            parentId
          });
          clusterLinks.push({ source: parentId, target: clusterId, type: 'contains' });
        }
      }
      if (urlKids.length > urlClusterThreshold) {
        const clusterId = `cluster:${parentId}:url`;
        if (!expandedClusters.has(clusterId)) {
          urlKids.forEach(id => hiddenNodes.add(id));
          urlKids.forEach(id => hiddenLinks.add(`${parentId}->${id}`));
          clusterNodes.push({
            id: clusterId,
            label: `URLs (${urlKids.length})`,
            type: 'cluster',
            clusterType: 'url',
            count: urlKids.length,
            parentId
          });
          clusterLinks.push({ source: parentId, target: clusterId, type: 'contains' });
        }
      }
    });

    const nodes = data.nodes.filter(n => !hiddenNodes.has(String(n.id))).concat(clusterNodes);
    const links = data.links.filter(l => {
      const src = String(typeof l.source === 'object' ? l.source.id : l.source);
      const tgt = String(typeof l.target === 'object' ? l.target.id : l.target);
      return !hiddenLinks.has(`${src}->${tgt}`);
    }).concat(clusterLinks);

    return { nodes, links };
  };

  const fetchAllScans = async (offset = 0) => {
    setScansLoading(true);
    setScansError('');
    try {
      const params = new URLSearchParams({
        limit: '10',
        offset: String(offset)
      });
      const res = await axios.get(`http://localhost:3001/api/scans?${params.toString()}`);
      setScansList(res.data.scans || []);
      setScansTotal(res.data.total || 0);
      setScansOffset(offset);
    } catch (err) {
      setScansError('Failed to load scans');
    } finally {
      setScansLoading(false);
    }
  };

  const fetchDomainSummaries = async () => {
    setScansLoading(true);
    setScansError('');
    try {
      const res = await axios.get('http://localhost:3001/api/scans/domains');
      setDomainSummaries(res.data.domains || []);
    } catch (err) {
      setScansError('Failed to load domain history');
    } finally {
      setScansLoading(false);
    }
  };

  const fetchDomainScans = async (domain, offset = 0) => {
    setScansLoading(true);
    setScansError('');
    try {
      const params = new URLSearchParams({
        limit: '10',
        offset: String(offset)
      });
      const res = await axios.get(`http://localhost:3001/api/scans/domain/${encodeURIComponent(domain)}?${params.toString()}`);
      setDomainScans(res.data.scans || []);
      setDomainOffset(offset);
    } catch (err) {
      setScansError('Failed to load domain scans');
    } finally {
      setScansLoading(false);
    }
  };

  const loadScanById = async (scanId, summaryOnly = true) => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`http://localhost:3001/api/scans/${encodeURIComponent(scanId)}${summaryOnly ? '?summary=1' : ''}`);
      const { scan, nodes, relationships, stages, logs } = res.data;
      if (scan?.target) setTarget(scan.target);
      setGraphData({ nodes: [], links: [] });
      setLazyGraphData({ nodes: [], links: [] });
      setExpandedClusters(new Set());
      if (!summaryOnly) {
        buildGraphFromNodes(nodes || [], scan?.website_id);
        setFullGraphLoaded(true);
      } else {
        setFullGraphLoaded(false);
      }
      setCurrentWebsiteId(scan?.website_id || null);
      setScansOpen(false);
      setShowScanBanner(true);
      setScanPanelOpen(true);
      setScanId(scan?.scan_id || scanId);
      setScanCancelling(false);
      const stageList = Array.isArray(stages) ? stages : [];
      const normalizeStageKey = (key) => {
        if (key === 'html_links') return 'hyperhtml';
        if (key === 'dirs') return 'directories';
        return key;
      };
      const stageMeta = stageList.reduce((acc, s) => {
        const key = normalizeStageKey(s.key);
        acc[key] = {
          durationSeconds: s.durationSeconds,
          status: s.status,
          message: s.status === 'timed_out' ? 'Timed out • partial' : s.status === 'capped' ? 'Capped • partial' : (s.status === 'failed' || s.status === 'cancelled' ? s.label : '')
        };
        return acc;
      }, {});
      const runningStage = stageList.find(s => s.status === 'running');
      const lastStage = stageList.length ? stageList[stageList.length - 1] : null;
      const currentStage = runningStage?.key || lastStage?.key || 'done';
      setScanStatus({
        status: scan?.status || 'completed',
        stage: currentStage,
        stageLabel: scan?.status || 'Completed',
        currentTarget: '',
        message: scan?.status || 'Completed',
        logTail: Array.isArray(logs) ? logs : [],
        updatedAt: scan?.last_update_at || scan?.finished_at || scan?.started_at || '',
        startedAt: scan?.started_at || '',
        stageMeta,
        rootNode: res.data?.root_node || null
      });
    } catch (err) {
      setError('Failed to load scan');
    } finally {
      setLoading(false);
    }
  };

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
    const root = nodes.find(n => n.type === 'host' && n.role === 'root') || nodes.find(n => n.type === 'host') || nodes[0];
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

    // if exactly one match, compute path from root to it
    if (matches.length === 1) {
      const rootNode = (nodes.find(n => n.type === 'host' && n.role === 'root') || nodes.find(n => n.type === 'host') || nodes[0]);
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
    setScanProgress(null);
    setShowScanBanner(true);
    setScanPanelOpen(true);
    setScanCancelling(false);
    setScanStatus({ status: 'queued', stage: 'start', stageLabel: 'Queued', currentTarget: '', message: 'Queued', logTail: [], updatedAt: '', stageMeta: {}, rootNode: null });
    try {
      const raw = String(target || '').trim();
      if (!raw) {
        setError('Target is required');
        setLoading(false);
        return;
      }
      const res = await axios.post('http://localhost:3001/api/scans', { target: raw });
      const scanId = res.data.scan_id;
      setScanId(scanId || '');
      if (!scanId) throw new Error('No scan_id returned');

      const poll = async () => {
        try {
          const statusRes = await axios.get(`http://localhost:3001/api/scans/${encodeURIComponent(scanId)}/status`, {
            headers: { 'Cache-Control': 'no-cache' }
          });
          const payload = statusRes.data || {};
          const status = payload.status || 'running';
          if (payload.progress) {
            setScanProgress(payload.progress);
          }
          setScanStatus((prev) => {
            const nextStageMeta = { ...(prev.stageMeta || {}) };
            const stageKey = payload.stage === 'html_links' ? 'hyperhtml' : payload.stage === 'dirs' ? 'directories' : payload.stage || '';
            if (payload.message && /timed out/i.test(payload.message) && stageKey) {
              nextStageMeta[stageKey] = { ...(nextStageMeta[stageKey] || {}), status: 'timed_out', message: 'Timed out • partial' };
            }
            if (payload.message && /capped/i.test(payload.message) && stageKey) {
              nextStageMeta[stageKey] = { ...(nextStageMeta[stageKey] || {}), status: 'capped', message: 'Capped • partial' };
            }
            return {
              status,
              stage: payload.stage || '',
              stageLabel: payload.stage_label || payload.message || 'Running',
              currentTarget: payload.current_target || '',
              message: payload.message || '',
              logTail: Array.isArray(payload.log_tail) ? payload.log_tail : (payload.log_tail ? [payload.log_tail] : []),
              updatedAt: payload.updated_at || '',
              startedAt: payload.started_at || '',
              stageMeta: nextStageMeta,
              rootNode: prev.rootNode || null
            };
          });
          if (status === 'completed') {
            const scanRes = await axios.get(`http://localhost:3001/api/scans/${encodeURIComponent(scanId)}?summary=1`);
            const { scan, nodes } = scanRes.data;
            if (scan?.target) setTarget(scan.target);
            setGraphData({ nodes: [], links: [] });
            setLazyGraphData({ nodes: [], links: [] });
            setCurrentWebsiteId(scan?.website_id || null);
            setScanProgress(null);
            setScanStatus({ status: 'completed', stage: 'done', stageLabel: 'Completed', currentTarget: '', message: 'Completed', logTail: [], updatedAt: '', stageMeta: scanStatus.stageMeta || {}, rootNode: scanRes.data?.root_node || null });
            setTimeout(() => setShowScanBanner(false), 3000);
            setTimeout(() => setScanPanelOpen(false), 3000);
            setLoading(false);
            setScanCancelling(false);
            return;
          }
          if (status === 'failed') {
            const failedStage = payload.stage || scanStatus.stage || 'start';
            setError(payload.message || 'Scan failed');
            setScanProgress(null);
            setScanStatus({ status: 'failed', stage: failedStage, stageLabel: 'Failed', currentTarget: '', message: payload.message || 'Failed', logTail: [], updatedAt: '', stageMeta: scanStatus.stageMeta || {}, rootNode: scanStatus.rootNode || null });
            setLoading(false);
            setScanCancelling(false);
            return;
          }
          if (status === 'cancelled') {
            const cancelledStage = payload.stage || scanStatus.stage || 'start';
            setScanProgress(null);
            setScanStatus({ status: 'cancelled', stage: cancelledStage, stageLabel: 'Cancelled', currentTarget: '', message: payload.message || 'Cancelled', logTail: Array.isArray(payload.log_tail) ? payload.log_tail : [], updatedAt: payload.updated_at || '', stageMeta: scanStatus.stageMeta || {}, rootNode: scanStatus.rootNode || null });
            setLoading(false);
            setScanCancelling(false);
            return;
          }
          setTimeout(poll, 1000);
        } catch (e) {
          setError('Failed to fetch scan status');
          setLoading(false);
          setTimeout(poll, 1500);
        }
      };
      poll();
    } catch (err) {
      console.error('Error starting scan:', err);
      setError('Failed to start scan');
      setScanProgress(null);
      setScanStatus({ status: 'failed', stage: 'start', stageLabel: 'Failed', currentTarget: '', message: 'Failed to start', logTail: [], updatedAt: '', stageMeta: {}, rootNode: scanStatus.rootNode || null });
      setLoading(false);
    }
  };

  const handleCancelScan = async () => {
    if (!scanId || scanCancelling) return;
    const confirm = window.confirm('Cancel this scan?');
    if (!confirm) return;
    setScanCancelling(true);
    setScanStatus((prev) => ({ ...prev, status: 'cancelling', stageLabel: 'Cancelling', message: 'Cancelling scan' }));
    try {
      // cancellation request: server stops the active scan
      await axios.post(`http://localhost:3001/api/scans/${encodeURIComponent(scanId)}/cancel`);
    } catch (e) {
      setScanCancelling(false);
      setError('Failed to cancel scan');
    }
  };

  // Load data from the database on first render
  React.useEffect(() => {
    // Auto-start disabled; scans start only from user action.
  }, []);

  const handleTreeSelect = async (node) => {
    try {
      if (!currentWebsiteId || !node?.id) {
        setSelectedNode(node || null);
        return;
      }
      const encodedNodeId = encodeURIComponent(node.id);
      const res = await axios.get(`http://localhost:3001/websites/${currentWebsiteId}/nodes/${encodedNodeId}`);
      setSelectedNode(res.data.node || node);
    } catch (e) {
      setSelectedNode(node || null);
    }
  };

  const handleTreeFocus = (node) => {
    if (!node?.id) return;
    try {
      if (window?.graphInstance?.focusOn) {
        window.graphInstance.focusOn(node.id, { zoom: 2, duration: 500 });
      }
    } catch (e) {
      console.debug('focusOn failed', e);
    }
  };

  useEffect(() => {
    if (viewMode !== 'graph') return;
    if (!scanId || fullGraphLoaded) return;
    loadScanById(scanId, false);
  }, [viewMode, scanId, fullGraphLoaded]);

  useEffect(() => {
    if (viewMode !== 'tree') return;
    setGraphData({ nodes: [], links: [] });
    setFullGraphLoaded(false);
  }, [viewMode]);

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
        <button
          onClick={() => {
            const raw = (target || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
            if (!raw) return;
            const url = `/api/report/full.pdf?scanId=${encodeURIComponent(raw)}`;
            window.open(url, '_blank');
          }}
          style={{ width: '100%', background: '#1f2937', color: '#d6e6ea', fontWeight: 600, fontSize: 14, border: '1px solid #24303b', borderRadius: 7, padding: '9px 0', marginBottom: 18, cursor: 'pointer' }}
        >
          Generate Full Report
        </button>
        {/* scan panel now renders on the right side */}
        <button
          onClick={() => {
            setScansOpen(true);
            setHistoryTab('domains');
            setSelectedDomain('');
            setScansQuery('');
            fetchDomainSummaries();
          }}
          disabled={loading}
          style={{ width: '100%', background: loading ? '#1a5e63' : '#0f172a', color: '#d6e6ea', fontWeight: 600, fontSize: 14, border: '1px solid #24303b', borderRadius: 7, padding: '9px 0', marginBottom: 18, cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          Show All Scans
        </button>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#9aa6b0', marginBottom: 6 }}>View Mode</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setViewMode('tree')}
              style={{
                flex: 1,
                padding: '6px 0',
                background: viewMode === 'tree' ? '#2de2e6' : '#1f2937',
                color: viewMode === 'tree' ? '#042426' : '#d6e6ea',
                border: '1px solid #24303b',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600
              }}
            >
              Tree
            </button>
            <button
              type="button"
              onClick={() => setViewMode('graph')}
              style={{
                flex: 1,
                padding: '6px 0',
                background: viewMode === 'graph' ? '#2de2e6' : '#1f2937',
                color: viewMode === 'graph' ? '#042426' : '#d6e6ea',
                border: '1px solid #24303b',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600
              }}
            >
              Graph
            </button>
          </div>
        </div>
        {viewMode === 'graph' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: '#9aa6b0', marginBottom: 6 }}>Graph Mode</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => setGraphMode('focus')}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  background: graphMode === 'focus' ? '#2de2e6' : '#1f2937',
                  color: graphMode === 'focus' ? '#042426' : '#d6e6ea',
                  border: '1px solid #24303b',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600
                }}
              >
                Focus
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: '#9aa6b0', display: 'flex', alignItems: 'center', gap: 6 }}>
                Depth
                <select
                  value={focusDepth}
                  onChange={(e) => setFocusDepth(Number(e.target.value))}
                  style={{ background: '#0f172a', color: '#d6e6ea', border: '1px solid #24303b', borderRadius: 6, fontSize: 12, padding: '4px 6px' }}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </label>
              <label style={{ fontSize: 12, color: '#9aa6b0', display: 'flex', alignItems: 'center', gap: 6 }}>
                Max nodes
                <select
                  value={maxGraphNodes}
                  onChange={(e) => setMaxGraphNodes(Number(e.target.value))}
                  style={{ background: '#0f172a', color: '#d6e6ea', border: '1px solid #24303b', borderRadius: 6, fontSize: 12, padding: '4px 6px' }}
                >
                  <option value={50}>50</option>
                  <option value={80}>80</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>
            <label style={{ fontSize: 12, color: '#9aa6b0', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <input type="checkbox" checked={hideUnrelated} onChange={(e) => setHideUnrelated(e.target.checked)} />
              Hide unrelated
            </label>
            <div style={{ fontSize: 12, color: '#9aa6b0', marginBottom: 6 }}>Supernode thresholds</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#9aa6b0', display: 'flex', alignItems: 'center', gap: 6 }}>
                Directories
                <input
                  type="number"
                  min="5"
                  max="200"
                  value={dirClusterThreshold}
                  onChange={(e) => setDirClusterThreshold(Number(e.target.value))}
                  style={{ width: 60, background: '#0f172a', color: '#d6e6ea', border: '1px solid #24303b', borderRadius: 6, fontSize: 12, padding: '4px 6px' }}
                />
              </label>
              <label style={{ fontSize: 12, color: '#9aa6b0', display: 'flex', alignItems: 'center', gap: 6 }}>
                URLs
                <input
                  type="number"
                  min="10"
                  max="500"
                  value={urlClusterThreshold}
                  onChange={(e) => setUrlClusterThreshold(Number(e.target.value))}
                  style={{ width: 60, background: '#0f172a', color: '#d6e6ea', border: '1px solid #24303b', borderRadius: 6, fontSize: 12, padding: '4px 6px' }}
                />
              </label>
            </div>
          </div>
        )}
        {error && (
          <div style={{ color: '#ff6b6b', marginBottom: 22, padding: '10px', background: 'rgba(255,107,107,0.1)', borderRadius: 6 }}>
            {error}
          </div>
        )}
        <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: '#9aa6b0', marginBottom: 6 }}>Progress</div>
          {(function() {
            const nodes = graphData.nodes || [];
            const subdomainsFallback = nodes.filter(n => n.type === 'host' && n.role === 'subdomain').length;
            const directoriesFallback = nodes.filter(n => n.type === 'dir').length;
            const endpointsFallback = nodes.filter(n => n.type === 'path' || n.type === 'file').length;

            const sub = scanProgress?.subdomains || { done: subdomainsFallback, percent: 0 };
            const dir = scanProgress?.directories || { done: directoriesFallback, percent: 0 };
            const end = scanProgress?.endpoints || { done: endpointsFallback, percent: 0 };

            const pct = (value, fallbackCount) => {
              if (value && typeof value.percent === 'number') return value.percent;
              const total = Math.max(subdomainsFallback + directoriesFallback + endpointsFallback, 1);
              return Math.round((fallbackCount / total) * 100);
            };

            return (
              <>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{sub.done} subdomains</span><span>{pct(sub, sub.done)}%</span></div>
                  <div style={{ height: 4, background: '#232b36', borderRadius: 2 }}><div style={{ width: `${pct(sub, sub.done)}%`, height: 4, background: '#2de2e6', borderRadius: 2 }} /></div>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{dir.done} directories</span><span>{pct(dir, dir.done)}%</span></div>
                  <div style={{ height: 4, background: '#232b36', borderRadius: 2 }}><div style={{ width: `${pct(dir, dir.done)}%`, height: 4, background: '#3b82f6', borderRadius: 2 }} /></div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{end.done} endpoints</span><span>{pct(end, end.done)}%</span></div>
                  <div style={{ height: 4, background: '#232b36', borderRadius: 2 }}><div style={{ width: `${pct(end, end.done)}%`, height: 4, background: '#fb923c', borderRadius: 2 }} /></div>
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

      {scansOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(2, 6, 12, 0.6)', zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 720, maxWidth: '92vw', maxHeight: '86vh', background: '#0b1117', border: '1px solid #1f2a33', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #1f2a33', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#e5f4f6' }}>Scan History</div>
              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                <button
                  onClick={() => {
                    setHistoryTab('domains');
                    setSelectedDomain('');
                    fetchDomainSummaries();
                  }}
                  style={{
                    padding: '6px 10px',
                    background: historyTab === 'domains' ? '#2de2e6' : '#1f2937',
                    color: historyTab === 'domains' ? '#042426' : '#d6e6ea',
                    border: '1px solid #24303b',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600
                  }}
                >
                  Domains
                </button>
                <button
                  onClick={() => {
                    setHistoryTab('all');
                    fetchAllScans(0);
                  }}
                  style={{
                    padding: '6px 10px',
                    background: historyTab === 'all' ? '#2de2e6' : '#1f2937',
                    color: historyTab === 'all' ? '#042426' : '#d6e6ea',
                    border: '1px solid #24303b',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600
                  }}
                >
                  All Scans
                </button>
              </div>
              <input
                value={scansQuery}
                onChange={(e) => setScansQuery(e.target.value)}
                placeholder="Filter by domain"
                style={{ padding: '6px 10px', background: '#0f172a', color: '#d6e6ea', border: '1px solid #24303b', borderRadius: 6, fontSize: 13, width: 220 }}
              />
              <button
                onClick={() => {
                  if (historyTab === 'all') fetchAllScans(0);
                  else fetchDomainSummaries();
                }}
                style={{ background: '#1f2937', color: '#d6e6ea', border: '1px solid #24303b', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}
              >
                Search
              </button>
              <button
                onClick={() => setScansOpen(false)}
                style={{ background: 'transparent', color: '#9aa6b0', border: 'none', fontSize: 20, cursor: 'pointer' }}
                aria-label="Close scans modal"
              >
                ×
              </button>
            </div>
            <div style={{ padding: 16, overflowY: 'auto' }}>
              {scansLoading && <div style={{ color: '#9aa6b0' }}>Loading scans…</div>}
              {scansError && <div style={{ color: '#ff6b6b', marginBottom: 8 }}>{scansError}</div>}
              {historyTab === 'domains' && !selectedDomain && (
                <>
                  {(domainSummaries || [])
                    .filter(d => String(d.domain || '').toLowerCase().includes(scansQuery.toLowerCase()))
                    .map((domain) => (
                      <div key={domain.domain} style={{ padding: 12, border: '1px solid #1f2a33', borderRadius: 10, marginBottom: 10, background: '#0f172a', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDomain(domain.domain);
                            setHistoryTab('domains');
                            fetchDomainScans(domain.domain, 0);
                          }}
                          style={{ fontWeight: 600, color: '#e5f4f6', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                          title="View domain history"
                        >
                          {domain.domain}
                        </button>
                        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: '#1f2937', color: '#93c5fd' }}>{domain.lastStatus}</span>
                        <span style={{ fontSize: 12, color: '#9aa6b0' }}>Scans: {domain.scanCount}</span>
                        <span style={{ fontSize: 12, color: '#9aa6b0' }}>Last: {formatLocalTime(domain.lastScanAt)}</span>
                      </div>
                    ))}
                  {!scansLoading && !domainSummaries.length && <div style={{ color: '#9aa6b0' }}>No scans found.</div>}
                </>
              )}
              {historyTab === 'domains' && selectedDomain && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDomain('');
                        fetchDomainSummaries();
                      }}
                      style={{ background: '#1f2937', color: '#d6e6ea', border: '1px solid #24303b', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}
                    >
                      Back
                    </button>
                    <div style={{ color: '#e5f4f6', fontWeight: 600 }}>History: {selectedDomain}</div>
                  </div>
                  {!scansLoading && !domainScans.length && <div style={{ color: '#9aa6b0' }}>No scans found.</div>}
                  {domainScans.map((scan) => (
                    <div key={scan.scan_id} style={{ padding: 12, border: '1px solid #1f2a33', borderRadius: 10, marginBottom: 10, background: '#0f172a', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ fontWeight: 600, color: '#e5f4f6' }}>{scan.target}</div>
                        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: '#1f2937', color: '#93c5fd' }}>{scan.status}</span>
                        <button
                          onClick={() => loadScanById(scan.scan_id, viewMode !== 'graph')}
                          style={{ marginLeft: 'auto', background: '#2de2e6', color: '#042426', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 600 }}
                        >
                          View
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, color: '#9aa6b0' }}>
                        <span>Started: {formatLocalTime(scan.started_at)}</span>
                        <span>Finished: {formatLocalTime(scan.finished_at)}</span>
                        {scan.elapsed_seconds != null && <span>Elapsed: {scan.elapsed_seconds}s</span>}
                      </div>
                    </div>
                  ))}
                </>
              )}
              {historyTab === 'all' && (
                <>
                  {!scansLoading && !scansList.length && <div style={{ color: '#9aa6b0' }}>No scans found.</div>}
                  {scansList
                    .filter(scan => String(scan.target || '').toLowerCase().includes(scansQuery.toLowerCase()))
                    .map((scan) => (
                      <div key={scan.scan_id} style={{ padding: 12, border: '1px solid #1f2a33', borderRadius: 10, marginBottom: 10, background: '#0f172a', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ fontWeight: 600, color: '#e5f4f6' }}>{scan.target}</div>
                          <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: '#1f2937', color: '#93c5fd' }}>{scan.status}</span>
                        <button
                          onClick={() => loadScanById(scan.scan_id, viewMode !== 'graph')}
                          style={{ marginLeft: 'auto', background: '#2de2e6', color: '#042426', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 600 }}
                        >
                          View
                        </button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, color: '#9aa6b0' }}>
                          <span>Started: {formatLocalTime(scan.started_at)}</span>
                          <span>Finished: {formatLocalTime(scan.finished_at)}</span>
                          {scan.elapsed_seconds != null && <span>Elapsed: {scan.elapsed_seconds}s</span>}
                        </div>
                      </div>
                    ))}
                </>
              )}
            </div>
            <div style={{ padding: 12, borderTop: '1px solid #1f2a33', display: 'flex', justifyContent: 'space-between' }}>
              <button
                onClick={() => {
                  if (historyTab === 'all') {
                    fetchAllScans(Math.max(0, scansOffset - 10));
                  } else if (selectedDomain) {
                    fetchDomainScans(selectedDomain, Math.max(0, domainOffset - 10));
                  }
                }}
                disabled={(historyTab === 'all' && scansOffset === 0) || (historyTab === 'domains' && selectedDomain && domainOffset === 0)}
                style={{ background: '#1f2937', color: '#d6e6ea', border: '1px solid #24303b', borderRadius: 6, padding: '6px 10px', fontSize: 12, opacity: (historyTab === 'all' && scansOffset === 0) || (historyTab === 'domains' && selectedDomain && domainOffset === 0) ? 0.5 : 1 }}
              >
                Prev
              </button>
              <div style={{ fontSize: 12, color: '#9aa6b0' }}>
                {historyTab === 'all' ? `${scansOffset + 1}-${Math.min(scansOffset + 10, scansTotal)} of ${scansTotal}` : selectedDomain ? `${domainOffset + 1}-${Math.min(domainOffset + 10, domainOffset + domainScans.length)}` : ''}
              </div>
              <button
                onClick={() => {
                  if (historyTab === 'all') {
                    fetchAllScans(scansOffset + 10);
                  } else if (selectedDomain) {
                    fetchDomainScans(selectedDomain, domainOffset + 10);
                  }
                }}
                disabled={historyTab === 'all' ? scansOffset + 10 >= scansTotal : !selectedDomain || domainScans.length < 10}
                style={{ background: '#1f2937', color: '#d6e6ea', border: '1px solid #24303b', borderRadius: 6, padding: '6px 10px', fontSize: 12, opacity: historyTab === 'all' ? (scansOffset + 10 >= scansTotal ? 0.5 : 1) : (!selectedDomain || domainScans.length < 10 ? 0.5 : 1) }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

  <div className="main-content">
        <div className="graph-area" style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', position: 'relative' }}>
          <div style={{ flex: 1, position: 'relative', width: '100%', height: '100%', minHeight: 0, display: 'flex' }}>
            {viewMode === 'tree' && (
              <div style={{ width: 320, borderRight: '1px solid #1f2a33', background: '#0b1117' }}>
                <TreeExplorer
                rootNode={scanStatus.rootNode || null}
                websiteId={currentWebsiteId}
                onSelect={handleTreeSelect}
                onGraphUpdate={setLazyGraphData}
                onFocus={handleTreeFocus}
                selectedNodeId={selectedNode?.id || null}
              />
            </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <HierarchicalGraph
                data={(function() {
                  const sourceData = viewMode === 'tree' ? lazyGraphData : graphData;
                  let prepared = sourceData;
                  if (viewMode === 'graph') {
                    if (graphMode === 'focus' && hideUnrelated) {
                      const root = (sourceData.nodes || []).find(n => n.type === 'host' && n.role === 'root') || (sourceData.nodes || [])[0];
                      let startId = selectedNode?.id || null;
                      if (startId != null) {
                        const byGraphId = (sourceData.nodes || []).find(n => String(n.id) === String(startId));
                        if (!byGraphId) {
                          const byApiId = (sourceData.nodes || []).find(n => String(n.apiId) === String(startId));
                          if (byApiId) startId = byApiId.id;
                        }
                      }
                      const resolvedStart = startId || root?.id || null;
                      prepared = buildFocusSubgraph(sourceData, resolvedStart, focusDepth, maxGraphNodes);
                    }
                    prepared = buildClusteredGraph(prepared);
                  }
                  // Filter nodes based on current filter settings
                  const visibleNodes = (prepared.nodes || []).filter(n => {
                    if (n.type === 'cluster') return true;
                    const status = String(n.status || '200').replace(/[^0-9]/g, '');
                    if (!statusFilters[status]) return false;
                    if (n.type && !typeFilters[n.type]) return false;
                    return true;
                  });
                  const visibleIds = new Set(visibleNodes.map(n => n.id));
                  const visibleLinks = (prepared.links || []).filter(l => {
                    const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
                    const targetId = typeof l.target === 'object' ? l.target.id : l.target;
                    return visibleIds.has(sourceId) && visibleIds.has(targetId);
                  });
                  return { nodes: visibleNodes, links: visibleLinks };
                })()}
                spacing={spacing}
                highlightedNodes={highlightedNodes}
                highlightPath={highlightPath}
                disableLevelSystem={viewMode === 'tree' || graphMode === 'focus'}
                selectedNodeId={selectedNode?.id || null}
                graphMode={graphMode}
                lockLayout={lockLayout}
                onToggleLock={setLockLayout}
                layoutPreset={graphLayout}
                onLayoutChange={setGraphLayout}
                onNodeClick={async (node, highlightIds) => {
                  try {
                    if (node?.type === 'cluster') {
                      setExpandedClusters(prev => {
                        const next = new Set(prev);
                        if (next.has(node.id)) next.delete(node.id);
                        else next.add(node.id);
                        return next;
                      });
                      return;
                    }
                    const apiId = node.apiId || node.id;
                    if (currentWebsiteId && apiId !== undefined && apiId !== null) {
                      const encodedNodeId = encodeURIComponent(apiId);
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
                }}
              />
            </div>
          </div>
        </div>
        {/* Details panel rendered alongside graph */}
        {(selectedNode || (showScanBanner && scanPanelOpen)) && (
          <DetailsPanel
            node={selectedNode}
            scan={showScanBanner && scanPanelOpen ? {
              scanId,
              target,
              status: scanStatus.status || 'running',
              startedAt: scanStatus.startedAt,
              lastUpdateAt: scanStatus.updatedAt,
              currentStage: scanStatus.stage || 'start',
              stageLabel: scanStatus.stageLabel,
              message: scanStatus.message,
              currentTarget: scanStatus.currentTarget,
            logLines: scanStatus.logTail,
            stageMeta: {
              ...(scanProgress?.subdomains?.done != null ? { subdomains: { count: scanProgress.subdomains.done } } : {}),
              ...(scanProgress?.directories?.done != null ? { directories: { count: scanProgress.directories.done } } : {}),
              ...(scanProgress?.endpoints?.done != null ? { hyperhtml: { count: scanProgress.endpoints.done } } : {}),
              ...(scanStatus.stage === 'build_graph' && scanStatus.message ? { build_graph: { message: scanStatus.message } } : {}),
              ...(scanStatus.stageLabel === 'Failed' ? {
                [scanStatus.stage === 'html_links' ? 'hyperhtml' : scanStatus.stage === 'dirs' ? 'directories' : scanStatus.stage]: { message: scanStatus.message }
              } : {}),
              ...(scanStatus.stageMeta || {})
            },
            onClose: () => setScanPanelOpen(false),
            onCancel: handleCancelScan,
            canCancel: scanStatus.status === 'running' || scanStatus.status === 'cancelling',
            cancelling: scanCancelling
          } : null}
            onClose={() => {
              setSelectedNode(null);
              setTimeout(() => {
                try {
                  if (window?.graphInstance?.manualFit) {
                    window.graphInstance.manualFit(400, 100, 80);
                  }
                } catch (e) {
                  console.debug('manualFit on close failed', e);
                }
              }, 1000);
            }}
          />
        )}
      </div>
    </div>
  );
}
