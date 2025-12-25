import React, { useRef, useEffect, useState, useCallback } from 'react';
import './Graph.css';
import ForceGraph2D from 'react-force-graph-2d';
import { forceManyBody, forceCollide, forceLink, forceCenter, forceRadial } from 'd3-force';

export const HierarchicalGraph = ({ data, onNodeClick, highlightedNodes = [], highlightPath = [] }) => {
  const containerRef = useRef(null);
  const fgRef = useRef(null);
  const suppressAutoFit = useRef(false);
  const [size, setSize] = useState({ width: 800, height: 520 });
  const [levels, setLevels] = useState(new Map());
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [maxVisibleLevel, setMaxVisibleLevel] = useState(null); // when set, force visibility by level
  const [layout, setLayout] = useState(() => {
    if (typeof window === 'undefined') return 'radial';
    try {
      return localStorage.getItem('graphLayoutPreset') || 'radial';
    } catch (e) {
      return 'radial';
    }
  });

  // Ensure any leftover debug panel from previous builds or edits is removed from the DOM
  useEffect(() => {
    try {
      if (typeof document !== 'undefined') {
        const old = document.getElementById('graph-debug');
        if (old) old.remove();
      }
    } catch (e) { /* ignore */ }
  }, []);

  // Local small component for level buttons rendered over the graph
  const LevelButtons = () => {
    // compute the current max existing level from data
    const maxLevel = React.useMemo(() => {
      if (!data || !data.nodes) return 1;
      let mx = 1;
      data.nodes.forEach(n => {
        const l = levels.get(n.id) ?? (n.type === 'domain' ? 1 : (n.type === 'subdomain' || n.type === 'directory' ? 2 : 3));
        if (l > mx) mx = l;
      });
      return mx;
    }, [data, levels]);

    const cur = maxVisibleLevel === null ? 1 : maxVisibleLevel;

    const setLevel = (lvl) => {
      const newLvl = Math.max(1, Math.min(maxLevel, lvl));
      setExpanded(() => new Set());
      setMaxVisibleLevel(newLvl);
    };

    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={() => setLevel((maxVisibleLevel===null?1:maxVisibleLevel) - 1)} title="Decrease level">−</button>
        <div className="level-display" style={{ minWidth: 84, textAlign: 'center', padding: '6px 10px', borderRadius: 6 }}>Level {cur}</div>
        <button onClick={() => setLevel((maxVisibleLevel===null?1:maxVisibleLevel) + 1)} title="Increase level">+</button>
        <button onClick={() => { setMaxVisibleLevel(null); setExpanded(() => new Set()); }} title="Clear level" style={{ marginLeft: 6 }}>Clear</button>
      </div>
    );
  };

  // Load persisted expandedNodes from localStorage once
  useEffect(() => {
    try {
      const raw = localStorage.getItem('expandedNodes');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setExpandedNodes(new Set(arr));
      }
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('graphLayoutPreset', layout);
    } catch (e) {
      // ignore persistence errors
    }
  }, [layout]);

  // centralized setter that persists and emits event
  const setExpanded = useCallback((updater) => {
    setExpandedNodes(prev => {
      const next = typeof updater === 'function' ? updater(prev) : new Set(updater);
      // Debug logging to help trace expansion changes
      try { console.debug('[graph] setExpanded ->', Array.from(next)); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('graphExpansionChanged', { detail: { expanded: Array.from(next) } })); } catch (e) {}
      try { localStorage.setItem('expandedNodes', JSON.stringify(Array.from(next))); } catch (e) {}
      return next;
    });
  }, []);

  // Compute node levels and update forces
  useEffect(() => {
    if (!data?.nodes?.length || !fgRef.current) return;

    const fg = fgRef.current;
    const root = data.nodes.find(n => n.type === 'domain');
    if (!root) return;

    // Assign hierarchical levels (1 = root domain, 2 = subdomain/directory, 3 = endpoint/file)
    const newLevels = new Map();
    data.nodes.forEach(node => {
      switch(node.type) {
        case 'domain': newLevels.set(node.id, 1); break;
        case 'subdomain': newLevels.set(node.id, 2); break;
        case 'directory': newLevels.set(node.id, 2); break;
        case 'endpoint':
        case 'file': newLevels.set(node.id, 3); break;
        default: newLevels.set(node.id, 3);
      }
    });
    setLevels(newLevels);
  }, [data]);

  // Function to expand all parents of a node to make it visible
  const expandToNode = useCallback((nodeId) => {
    if (!data || !data.nodes || !data.links) return;
    
    const nodesToExpand = new Set();
    const findParents = (id) => {
      const parentLinks = data.links.filter(l => l.target === id && l.type === 'contains');
      parentLinks.forEach(link => {
        nodesToExpand.add(link.source);
        findParents(link.source);
      });
    };
    
    findParents(nodeId);
  setExpanded(prev => new Set([...prev, ...nodesToExpand]));
  }, [data]);

  const manualFit = useCallback((padding = 420, duration = 160, delay = 120) => {
    suppressAutoFit.current = true;
    setTimeout(() => {
      const inst = fgRef.current;
      if (!inst || typeof inst.zoomToFit !== 'function') {
        suppressAutoFit.current = false;
        return;
      }
      try {
        inst.zoomToFit(padding, duration);
      } catch (e) {
        console.debug('[graph] manualFit error', e);
      } finally {
        setTimeout(() => { suppressAutoFit.current = false; }, duration + 80);
      }
    }, Math.max(0, delay));
  }, []);

  // Expose zoom-related helpers globally
  useEffect(() => {
    const expandType = (type) => {
      if (!data || !data.nodes) return;
      const roots = data.nodes.filter(n => n.type === type).map(n => n.id);
      setExpanded(prev => new Set([...prev, ...roots]));
    };

    const expandNode = (nodeId) => setExpanded(prev => new Set([...prev, nodeId]));
    const collapseNode = (nodeId) => setExpanded(prev => { const next = new Set(prev); next.delete(nodeId); return next; });
    const toggleNode = (nodeId) => setExpanded(prev => { const next = new Set(prev); if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId); return next; });
    const collapseAll = () => setExpanded(() => new Set());
    // Expand immediate children of a node (one level)
    const expandChildren = (nodeId) => {
      if (!data || !data.links) return;
      const children = data.links.filter(l => l.source === nodeId && l.type === 'contains').map(l => l.target);
      if (!children.length) return;
      setExpanded(prev => new Set([...prev, ...children]));
    };

    // Recursively expand all descendants of a node
    const expandAllDescendants = (nodeId) => {
      if (!data || !data.links) return;
      const toVisit = [nodeId];
      const all = new Set();
      while (toVisit.length) {
        const cur = toVisit.pop();
        const kids = data.links.filter(l => l.source === cur && l.type === 'contains').map(l => l.target);
        for (const k of kids) {
          if (!all.has(k)) {
            all.add(k);
            toVisit.push(k);
          }
        }
      }
      setExpanded(prev => new Set([...prev, ...all]));
    };

    // Expand up to a given hierarchical level (0 = root only). When used we switch to
    // a level-driven visibility mode: getVisibleNodes will return nodes whose level <= given
    // level and ignore the normal expansion set. This prevents accidentally expanding beyond
    // the maximum depth present in the graph.
    const expandToLevel = (level) => {
      // compute integer level
      const lvl = Number.isFinite(Number(level)) ? Math.max(0, Math.floor(Number(level))) : 0;
      // clear manual expansions to avoid conflicting state
      setExpanded(() => new Set());
      setMaxVisibleLevel(lvl);
      try { console.debug('[graph] expandToLevel ->', lvl); } catch (e) {}
    };

    const clearLevel = () => {
      setMaxVisibleLevel(null);
      try { console.debug('[graph] clearLevel'); } catch (e) {}
    };

    // Shrink (collapse) immediate children of a node
    const shrinkChildren = (nodeId) => {
      if (!data || !data.links) return;
      const children = data.links.filter(l => l.source === nodeId && l.type === 'contains').map(l => l.target);
      if (!children.length) return;
      setExpanded(prev => {
        const next = new Set(prev);
        children.forEach(c => next.delete(c));
        return next;
      });
    };

    const isExpanded = (nodeId) => expandedNodes.has(nodeId);

  // debug overlay removed: no DOM debug panel

    // Wrap methods to log calls and update debug overlay
    window.graphInstance = {
      expandType: (...a) => { try { console.debug('[graph] expandType', ...a); } catch(e){}; return expandType(...a); },
      expandNode: (...a) => { try { console.debug('[graph] expandNode', ...a); } catch(e){}; return expandNode(...a); },
      collapseNode: (...a) => { try { console.debug('[graph] collapseNode', ...a); } catch(e){}; return collapseNode(...a); },
      toggleNode: (...a) => { try { console.debug('[graph] toggleNode', ...a); } catch(e){}; return toggleNode(...a); },
      collapseAll: (...a) => { try { console.debug('[graph] collapseAll', ...a); } catch(e){}; return collapseAll(...a); },
      expandChildren: (...a) => { try { console.debug('[graph] expandChildren', ...a); } catch(e){}; return expandChildren(...a); },
      expandAllDescendants: (...a) => { try { console.debug('[graph] expandAllDescendants', ...a); } catch(e){}; return expandAllDescendants(...a); },
      shrinkChildren: (...a) => { try { console.debug('[graph] shrinkChildren', ...a); } catch(e){}; return shrinkChildren(...a); },
      expandToLevel: (...a) => { try { console.debug('[graph] expandToLevel', ...a); } catch(e){}; return expandToLevel(...a); },
      clearLevel: (...a) => { try { console.debug('[graph] clearLevel', ...a); } catch(e){}; return clearLevel(...a); },
      isExpanded: (...a) => { try { console.debug('[graph] isExpanded', ...a); } catch(e){}; return isExpanded(...a); },
      getExpandedNodes: () => { try { console.debug('[graph] getExpandedNodes'); } catch(e){}; return Array.from(expandedNodes); },
      manualFit: (...a) => { try { console.debug('[graph] manualFit', ...a); } catch(e){}; return manualFit(...a); },
      focusOn: (id, opts = {}) => {
        try { console.debug('[graph] focusOn', id, opts); } catch(e){}
        const n = (data?.nodes || []).find(nn => nn.id === id);
        if (!n) return;
        const { zoom = 1.8, duration = 600, delay = 100 } = opts;
        const inst = fgRef.current;
        if (!inst || !isFinite(n.x) || !isFinite(n.y)) return;
        suppressAutoFit.current = true;
        try {
          inst.centerAt(n.x, n.y, duration);
          inst.zoom(zoom, duration);
        } finally {
          setTimeout(() => { suppressAutoFit.current = false; }, duration + 60);
        }
      },
      setLayoutPreset: (preset) => {
        if (!preset) return;
        const next = String(preset).toLowerCase();
        try { console.debug('[graph] setLayoutPreset', next); } catch (e) {}
        setLayout(prev => (prev === next ? prev : next));
      },
      getLayoutPreset: () => {
        try { console.debug('[graph] getLayoutPreset ->', layout); } catch (e) {}
        return layout;
      }
      };
    }, [data, expandToNode, manualFit, layout]);

  const focusOnNode = useCallback((node, { zoom = 1.8, duration = 600, delay = 140, retries = 3 } = {}) => {
    if (!node) return;

    const attempt = (remaining) => {
      const inst = fgRef.current;
      if (!inst || !isFinite(node.x) || !isFinite(node.y)) {
        if (remaining <= 0) return;
        setTimeout(() => attempt(remaining - 1), 120);
        return;
      }
      suppressAutoFit.current = true;
      try {
        inst.centerAt(node.x, node.y, duration);
        inst.zoom(zoom, duration);
      } finally {
        setTimeout(() => { suppressAutoFit.current = false; }, duration + 60);
      }
    };

    setTimeout(() => attempt(retries), Math.max(0, delay));
  }, []);

  // Filter visible nodes based on hierarchy and expansion state
  const getVisibleNodes = useCallback(() => {
    if (!data || !data.nodes) return [];

    // Build parent map from links
    const parentMap = new Map();
    (data.links || []).forEach(l => {
      if (l.type !== 'contains') return;
      const src = typeof l.source === 'object' ? l.source.id : l.source;
      const tgt = typeof l.target === 'object' ? l.target.id : l.target;
      const arr = parentMap.get(tgt) || [];
      arr.push(src);
      parentMap.set(tgt, arr);
    });

    const visible = new Set();
    // If level-driven visibility mode is active, show nodes up to that level only
    if (maxVisibleLevel !== null) {
      data.nodes.forEach(n => {
        const lvl = levels.get(n.id) ?? (n.type === 'domain' ? 1 : (n.type === 'subdomain' || n.type === 'directory' ? 2 : 3));
        if (lvl <= maxVisibleLevel) visible.add(n.id);
      });
    } else {
      // Show root domain and its immediate subdomain children by default
      const root = data.nodes.find(n => n.type === 'domain');
      if (root) visible.add(root.id);
      (data.links || []).forEach(l => {
        if (l.type !== 'contains') return;
        const src = typeof l.source === 'object' ? l.source.id : l.source;
        const tgt = typeof l.target === 'object' ? l.target.id : l.target;
        if (src === root?.id) {
          const childNode = data.nodes.find(nn => nn.id === tgt);
          if (childNode && childNode.type === 'subdomain') visible.add(tgt);
        }
      });
    }

    // Helper: is any ancestor expanded?
    const isAncestorExpanded = (nodeId, seen = new Set()) => {
      if (seen.has(nodeId)) return false;
      seen.add(nodeId);
      const parents = parentMap.get(nodeId) || [];
      for (const p of parents) {
        if (expandedNodes.has(p)) return true;
        if (isAncestorExpanded(p, seen)) return true;
      }
      return false;
    };

    // Include endpoints and files only if they have an expanded ancestor
    data.nodes.forEach(n => {
      if (n.type === 'endpoint' || n.type === 'file' || n.type === 'directory' || n.type === 'subdomain') {
        if (maxVisibleLevel === null) {
          // normal mode: include only if ancestor expanded
          if (isAncestorExpanded(n.id)) visible.add(n.id);
        } else {
          // level mode: already included above by level check
        }
      }
    });

    // Build resulting visible nodes array and add simple level hints
    const visibleNodes = [];
    data.nodes.forEach(n => {
      if (visible.has(n.id)) {
        n.level = n.type === 'domain' ? 1 : (n.type === 'subdomain' || n.type === 'directory' ? 2 : 3);
        visibleNodes.push(n);
      }
    });

    return visibleNodes;
  }, [data, expandedNodes]);
  
  // Get visible links based on visible nodes
  const getVisibleLinks = useCallback((visibleNodes) => {
    if (!data || !data.links) return [];
    
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
    return data.links.filter(l => {
      const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      return visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId);
    });
  }, [data]);

  // Enhanced color mapping based on hierarchy
  const getNodeColor = useCallback((node) => {
    if (!node || !node.type) return '#9CA3AF';
    
    const colors = {
      domain: '#DC2626',      // Red - Target domain (center)
      subdomain: '#2563EB',   // Blue - Level 2
      directory: '#059669',   // Green - Level 3  
      endpoint: '#EA580C',    // Orange - Level 4
      file: '#D97706',        // Amber - Level 4
      port: '#7C3AED',        // Purple
      service: '#0891B2',     // Cyan
    };
    
    return colors[node.type] || '#6B7280';
  }, []);
  
  // Get node size based on type and expansion state
  const getNodeSize = useCallback((node) => {
    const baseSizes = {
      domain: 25,
      subdomain: 18,
      directory: 14,
      endpoint: 12,
      file: 12,
      port: 10,
      service: 10
    };
    
    const baseSize = baseSizes[node.type] || 10;
    
    // Make expanded nodes slightly larger
    const expandedMultiplier = expandedNodes.has(node.id) ? 1.2 : 1;
    
    // Make highlighted nodes larger
    const highlightMultiplier = highlightedNodes.includes(String(node.id)) ? 1.3 : 1;
    
    return baseSize * expandedMultiplier * highlightMultiplier;
  }, [expandedNodes, highlightedNodes]);
  
  // Handle node click with expand/collapse functionality
  const handleNodeClick = useCallback((node) => {
    if (!node) return;
    expandToNode(node.id);
    
    // Check if node has children
    const hasChildren = data?.links?.some(l => l.source === node.id && l.type === 'contains');
    
    if (hasChildren) {
      // Toggle expansion state using centralized setter (persists and emits change event)
      setExpanded(prev => {
        const newSet = new Set(prev);
        if (newSet.has(node.id)) {
          // Collapse: remove this node and its immediate children (do not recurse)
          newSet.delete(node.id);
          const childLinks = data.links.filter(l => l.source === node.id && l.type === 'contains');
          childLinks.forEach(link => newSet.delete(link.target));
        } else {
          // Expand: add node id (do not auto-expand grandchildren)
          newSet.add(node.id);
          // For convenience, also ensure immediate children become visible only when desired.
          // (Do not add descendants recursively.)
        }
        return newSet;
      });
    }
    
    focusOnNode(node);
    
    // Notify parent component
    onNodeClick && onNodeClick(node, [node.id]);
  }, [data, expandToNode, focusOnNode, onNodeClick]);
  
  // Generate rich tooltip content
  const getTooltip = useCallback((node) => {
    if (!node) return '';
    
    const hasChildren = data?.links?.some(l => l.source === node.id && l.type === 'contains');
    const childrenCount = data?.links?.filter(l => l.source === node.id && l.type === 'contains').length || 0;
    const isExpanded = expandedNodes.has(node.id);
    
    return `<div style="background: #1F2937; color: white; padding: 14px; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); max-width: 280px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
      <div style="font-weight: bold; color: ${getNodeColor(node)}; margin-bottom: 10px; font-size: 14px;">${node.value || node.id}</div>
      
      <div style="margin-bottom: 6px; display: flex; justify-content: space-between;">
        <span style="color: #9CA3AF; font-size: 12px;">Type:</span>
        <span style="font-size: 12px; text-transform: capitalize;">${node.type}</span>
      </div>
      
      ${node.status ? `<div style="margin-bottom: 6px; display: flex; justify-content: space-between;">
        <span style="color: #9CA3AF; font-size: 12px;">Status:</span>
        <span style="color: ${node.status >= 200 && node.status < 300 ? '#10B981' : node.status >= 400 ? '#EF4444' : '#F59E0B'}; font-size: 12px; font-weight: 500;">${node.status}</span>
      </div>` : ''}
      
      ${node.size ? `<div style="margin-bottom: 6px; display: flex; justify-content: space-between;">
        <span style="color: #9CA3AF; font-size: 12px;">Size:</span>
        <span style="font-size: 12px;">${formatBytes(node.size)}</span>
      </div>` : ''}
      
      ${hasChildren ? `<div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid #374151;">
        <div style="font-size: 11px; color: #6B7280; margin-bottom: 4px;">
          ${childrenCount} ${childrenCount === 1 ? 'child' : 'children'}
        </div>
        <div style="font-size: 11px; color: #3B82F6;">
          Click to ${isExpanded ? 'collapse' : 'expand'}
        </div>
      </div>` : ''}
    </div>`;
  }, [data, expandedNodes, getNodeColor]);

  // Format bytes utility
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    
    const resize = () => {
      const rect = el.getBoundingClientRect();
      setSize({ 
        width: Math.max(400, Math.floor(rect.width)), 
        height: Math.max(300, Math.floor(rect.height)) 
      });
    };
    
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    
    return () => ro.disconnect();
  }, []);

  // Get current visible graph data
  const visibleNodes = getVisibleNodes();
  const visibleLinks = getVisibleLinks(visibleNodes);
  const graphData = { nodes: visibleNodes, links: visibleLinks };

  // Set up hierarchical positioning
  useEffect(() => {
    try {
      if (!fgRef.current || !visibleNodes.length) return;
    
    // Enhanced force configuration for hierarchical layout
    const simulation = fgRef.current.d3Force;
    if (simulation) {
      // Radial force to organize by hierarchy level
      
      simulation('radial', forceRadial(
        (node) => ((node.level || 1) - 1) * 160 + 60, // Distance: level 1 -> 0 offset, level 2 -> 160, level 3 -> 320
        size.width / 2,
        size.height / 2
      ).strength(0.9));
      
      simulation('charge', forceManyBody()
        .strength((node) => {
          const baseStrength = -300;
          const levelMultiplier = Math.max(0.3, 1 - (node.level || 0) * 0.2);
          return baseStrength * levelMultiplier;
        })
      );
      
      simulation('collision', forceCollide()
        .radius((node) => getNodeSize(node) + 15)
        .strength(0.9)
      );
      
      // Normalize links so d3-force receives node objects as source/target to avoid "node not found" errors
      const idMap = new Map(visibleNodes.map(n => [n.id, n]));
      const normalizedLinks = visibleLinks.map(l => {
        const srcId = typeof l.source === 'object' ? l.source.id : l.source;
        const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
        const srcNode = idMap.get(srcId);
        const tgtNode = idMap.get(tgtId);
        if (!srcNode || !tgtNode) return null; // will be filtered out
        return Object.assign({}, l, { source: srcNode, target: tgtNode });
      }).filter(Boolean);

      simulation('link', forceLink(normalizedLinks)
        .id(d => d.id)
        .distance((link) => {
          const sourceNode = link.source;
          const targetNode = link.target;
          const levelDiff = Math.abs((sourceNode?.level || 1) - (targetNode?.level || 1));
          return 100 + levelDiff * 60; // Longer links between different levels
        })
        .strength(0.6)
      );
      
      simulation('center', forceCenter(size.width / 2, size.height / 2).strength(0.1));
    }
    } catch (err) {
      console.error('[graph] layout error', err);
    }
  }, [visibleNodes, visibleLinks, size, getNodeSize]);

  // Toolbar actions: zoom in/out, reset home (fit), expand all, collapse all
  const zoomIn = () => {
    try {
      const fg = fgRef.current;
      if (!fg) return;
  let cur = 1;
      try { cur = fg.zoom(); } catch (e) { /* ignore if not available */ }
      const next = Math.min(6, cur * 1.3);
  suppressAutoFit.current = true;
  fg.zoom(next, 300);
  setTimeout(() => { suppressAutoFit.current = false; }, 350);
    } catch (e) { console.debug('[graph] zoomIn error', e); }
  };

  const zoomOut = () => {
    try {
      const fg = fgRef.current;
      if (!fg) return;
      let cur = 1;
      try { cur = fg.zoom(); } catch (e) { /* ignore */ }
      const next = Math.max(0.2, cur / 1.3);
  suppressAutoFit.current = true;
  fg.zoom(next, 300);
  setTimeout(() => { suppressAutoFit.current = false; }, 350);
    } catch (e) { console.debug('[graph] zoomOut error', e); }
  };

  const goHome = () => {
    try {
      manualFit(400, 100, 80);
    } catch (e) { console.debug('[graph] goHome error', e); }
  };

  const handleExpandAll = () => {
    if (!data || !data.links) return;
    const parents = new Set();
    data.links.forEach(l => {
      if (l.type !== 'contains') return;
      const src = typeof l.source === 'object' ? l.source.id : l.source;
      parents.add(src);
    });
    setExpanded(prev => new Set([...prev, ...Array.from(parents)]));
  };

  const handleCollapseAll = () => {
    setExpanded(() => new Set());
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Level controls (placed over graph) */}
      <div className="graph-toolbar">
        <div className="panel">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={zoomIn} title="Zoom in" aria-label="Zoom in">🔍+</button>
            <button onClick={zoomOut} title="Zoom out" aria-label="Zoom out">🔍−</button>
            <button onClick={goHome} title="Fit to view" aria-label="Home">🏠</button>
          </div>

          <div className="sep" />

          <LevelButtons />

          {/* removed expand/collapse buttons as requested */}
        </div>
      </div>
      <ForceGraph2D
        ref={fgRef}
        width={size.width}
        height={size.height}
        graphData={graphData}
        
        // Node styling
        nodeColor={getNodeColor}
        nodeVal={getNodeSize}
        nodeLabel={getTooltip}
        
        // Node interactions
        onNodeClick={handleNodeClick}
        
        // Link styling
        linkWidth={(link) => {
          const src = String(typeof link.source === 'object' ? link.source.id : link.source);
          const tgt = String(typeof link.target === 'object' ? link.target.id : link.target);
          const isHighlighted = highlightPath.includes(src) && highlightPath.includes(tgt);
          if (isHighlighted) return 4;
          return link.type === 'contains' ? 2.5 : 1;
        }}
        
        linkColor={(link) => {
          const src = String(typeof link.source === 'object' ? link.source.id : link.source);
          const tgt = String(typeof link.target === 'object' ? link.target.id : link.target);
          const isHighlighted = highlightPath.includes(src) && highlightPath.includes(tgt);
          if (isHighlighted) return '#F59E0B';
          return link.type === 'contains' ? 'rgba(96,165,250,0.92)' : 'rgba(156,163,175,0.28)';
        }}
        
        linkDirectionalArrowLength={0}
        linkDirectionalArrowRelPos={0.9}
        linkDirectionalArrowColor={(link) => {
          const src = String(typeof link.source === 'object' ? link.source.id : link.source);
          const tgt = String(typeof link.target === 'object' ? link.target.id : link.target);
          const isHighlighted = highlightPath.includes(src) && highlightPath.includes(tgt);
          return isHighlighted ? '#F59E0B' : 'rgba(96,165,250,0.9)';
        }}
        // Animate particles for highlighted links to show 'diff' or active paths
        linkDirectionalParticles={1}
        linkDirectionalParticleWidth={(link) => {
          const src = String(typeof link.source === 'object' ? link.source.id : link.source);
          const tgt = String(typeof link.target === 'object' ? link.target.id : link.target);
          const isHighlighted = highlightPath.includes(src) && highlightPath.includes(tgt);
          return isHighlighted ? 3 : 0;
        }}
        linkDirectionalParticleColor={(link) => {
          const src = String(typeof link.source === 'object' ? link.source.id : link.source);
          const tgt = String(typeof link.target === 'object' ? link.target.id : link.target);
          const isHighlighted = highlightPath.includes(src) && highlightPath.includes(tgt);
          return isHighlighted ? '#F59E0B' : 'rgba(0,0,0,0)';
        }}
        linkDirectionalParticleSpeed={(link) => {
          const src = String(typeof link.source === 'object' ? link.source.id : link.source);
          const tgt = String(typeof link.target === 'object' ? link.target.id : link.target);
          const isHighlighted = highlightPath.includes(src) && highlightPath.includes(tgt);
          return isHighlighted ? 0.8 : 0;
        }}
        
  // Performance optimizations
  cooldownTicks={100}
  onEngineStop={() => { /* disable automatic fit; manualFit handles explicit requests */ }}
        
        // Custom node rendering for better visuals
        nodeCanvasObjectMode={() => 'after'}
        nodeCanvasObject={(node, ctx, globalScale) => {
            // positions may be undefined early in the simulation; skip drawing until valid
            if (node.x === undefined || node.y === undefined || !isFinite(node.x) || !isFinite(node.y)) return;

            // Enhanced node rendering: draw circle with ring, optional glow, and a visible name label
            const nodeRadius = getNodeSize(node);
            const hasChildren = data?.links?.some(l => l.source === node.id && l.type === 'contains');
            const isExpanded = expandedNodes.has(node.id);
            const isHighlighted = highlightedNodes.includes(String(node.id));

            // glow for highlighted nodes
            if (isHighlighted) {
              try {
                const glowSize = Math.max(nodeRadius * 2.5, 20);
                const gradient = ctx.createRadialGradient(node.x, node.y, nodeRadius, node.x, node.y, glowSize);
                gradient.addColorStop(0, getNodeColor(node));
                gradient.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.beginPath();
                ctx.arc(node.x, node.y, glowSize, 0, 2 * Math.PI, false);
                ctx.fillStyle = gradient;
                ctx.fill();
              } catch (e) {}
            }

            // main node circle
            ctx.beginPath();
            ctx.arc(node.x, node.y, nodeRadius, 0, 2 * Math.PI, false);
            ctx.fillStyle = getNodeColor(node);
            ctx.fill();

            // outer ring to indicate expanded state
            ctx.lineWidth = isExpanded ? Math.max(2, 2 / Math.max(1, globalScale)) : 1;
            ctx.strokeStyle = isExpanded ? 'rgba(16,185,129,0.95)' : 'rgba(255,255,255,0.06)';
            ctx.stroke();

            // draw name label below the node
            try {
              const label = node.label || node.value || node.id;
              ctx.save();
              ctx.font = `${Math.max(10, 12 / globalScale)}px Inter, Arial`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillStyle = 'rgba(226, 239, 243, 0.95)';
              // subtle background for text for readability
              const textWidth = ctx.measureText(label).width;
              const pad = 6;
              const tx = node.x - textWidth / 2 - pad / 2;
              const ty = node.y + nodeRadius + 8;
              ctx.fillStyle = 'rgba(8,10,12,0.55)';
              ctx.fillRect(tx, ty - 2, textWidth + pad, Math.max(16, 14 / Math.max(1, globalScale)) + 4);
              ctx.fillStyle = 'rgba(226, 239, 243, 0.98)';
              ctx.fillText(label, node.x, ty + 2);
              ctx.restore();
            } catch (e) {}

            // Draw compact expansion indicator (small circle with +/−)
            // Skip indicator for the root domain node to avoid showing a misleading '+' on root
            if (hasChildren && node.type !== 'domain') {
              ctx.save();
              const indicatorR = Math.max(8, nodeRadius * 0.55);
              const ix = node.x + nodeRadius - indicatorR;
              const iy = node.y - nodeRadius + indicatorR;
              ctx.beginPath();
              ctx.arc(ix, iy, indicatorR, 0, 2 * Math.PI, false);
              ctx.fillStyle = isExpanded ? '#10B981' : '#6B7280';
              ctx.fill();
              ctx.fillStyle = 'white';
              ctx.font = `${Math.max(8, 10 / globalScale)}px Arial`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(isExpanded ? '−' : '+', ix, iy);
              ctx.restore();
            }
        }}
      />
      
  {/* legend removed per user request - they already have an external explanation */}
    </div>
  );
};
