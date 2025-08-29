import React, { useRef, useEffect, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { forceManyBody, forceCollide, forceLink } from 'd3-force';

export const Graph = ({ data, onNodeClick, highlightedNodes = [], highlightPath = [] }) => {
  const containerRef = useRef(null);
  const fgRef = useRef(null);
  const prevSpacingRef = useRef(null);
  const [size, setSize] = useState({ width: 800, height: 520 });
  const didAutoFitRef = useRef(false);

  // Expose a simple zoomToNode function globally for external control
  useEffect(() => {
    window.graphInstance = {
      zoomToNode: (nodeId, zoom = 1.5, duration = 400) => {
        const node = (data.nodes || []).find(n => n.id === nodeId);
        if (fgRef.current && node && typeof node.x === 'number' && typeof node.y === 'number') {
          fgRef.current.centerAt(node.x, node.y, duration);
          fgRef.current.zoom(zoom, duration);
        }
      }
    };
  }, [data]);

  const nodesAddedAt = useRef(new Map()); // nodeId -> timestamp when first seen

  // build quick lookup sets for highlights / path links
  const highlightedSet = new Set((highlightedNodes || []).map(String));
  const pathLinks = useRef(new Set());
  useEffect(() => {
    const p = highlightPath || [];
    const s = new Set();
    for (let i = 0; i < p.length - 1; i++) {
      const a = String(p[i]);
      const b = String(p[i + 1]);
      s.add(`${a}~${b}`);
      s.add(`${b}~${a}`);
    }
    pathLinks.current = s;
  }, [highlightPath]);

  // Resize observer to make the graph responsive to its container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const resize = () => {
      const r = el.getBoundingClientRect();
      setSize({ width: Math.max(200, Math.floor(r.width)), height: Math.max(200, Math.floor(r.height)) });
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    return () => {
      ro.disconnect();
    };
  }, []);

  // track newly added nodes to animate them
  useEffect(() => {
    if (!data || !Array.isArray(data.nodes)) return;
    const now = Date.now();
    const currentIds = new Set(data.nodes.map(n => n.id));
    // add timestamps for new nodes
    for (const n of data.nodes) {
      if (!nodesAddedAt.current.has(n.id)) nodesAddedAt.current.set(n.id, now);
    }
    // remove timestamps for nodes that disappeared
    for (const k of Array.from(nodesAddedAt.current.keys())) {
      if (!currentIds.has(k)) nodesAddedAt.current.delete(k);
    }
  }, [data]);

  // color mapping for groups - consistent color coding as requested
  const nodeColor = (node) => {
    if (!node || !node.type) return '#bbb';
    switch (node.type) {
      case 'domain': return 'rgba(255,255,255,0.95)'; // white - Root
      case 'subdomain': return 'rgba(45,226,230,0.95)'; // cyan - Subdomains
      case 'directory': return 'rgba(59,130,246,0.95)'; // blue - Directories
      case 'endpoint': return 'rgba(251,146,60,0.95)'; // orange - Endpoints
      case 'file': return 'rgba(251,146,60,0.95)'; // orange - Files (like endpoints)
      default: return '#bbb';
    }
  };

  // Optimized auto-fit zoom when data changes (run once after first data load)
  useEffect(() => {
    if (!fgRef.current || !data || !data.nodes?.length) return;
    if (didAutoFitRef.current) return;
    
    // Wait for layout to settle, then auto-fit
    const autoFitTimeout = setTimeout(() => {
      try {
        if (fgRef.current && fgRef.current.zoomToFit) {
          // Auto-fit with more padding for better spacing visibility
          fgRef.current.zoomToFit(800, 100); // 800ms transition, 100px padding (increased)
          didAutoFitRef.current = true;
        }
      } catch (e) {
        console.log('Auto-fit zoom failed:', e);
      }
    }, 300); // Increased delay for layout to settle
    
    return () => clearTimeout(autoFitTimeout);
  }, [data]);

  // on click: center and notify parent
  const handleNodeClick = (node) => {
    if (!node) return;
    try {
      fgRef.current && fgRef.current.centerAt && fgRef.current.centerAt(node.x, node.y, 400);
      fgRef.current && fgRef.current.zoom && fgRef.current.zoom(Math.min(2.2, Math.max(0.8, 1.6)), 400);
    } catch (e) {}
    // Pass highlighted node id to parent
    onNodeClick && onNodeClick(node, [node.id]);
  };

  // custom node renderer: animate appearance of new nodes
  const nodeCanvasObject = (node, ctx, globalScale) => {
    // Use actual node name (value) instead of ID
    const label = node.value || node.id;
    const baseSize = Math.max(6, (node.val || 8));

    // animation progress based on when node was first seen
    const addedAt = nodesAddedAt.current.get(node.id) || Date.now();
    const age = Date.now() - addedAt;
    const dur = 900; // ms
    const t = Math.min(1, age / dur);
    // ease-out
    const ease = 1 - Math.pow(1 - t, 3);
    const sizeVal = Math.max(1, baseSize * (0.3 + 0.7 * ease));

    // Make root domain larger
    const finalSize = node.type === 'domain' ? sizeVal * 1.5 : sizeVal;

    // highlight halo if node is highlighted
    if (typeof highlightedSet !== 'undefined' && highlightedSet.has(String(node.id))) {
      ctx.save();
      ctx.beginPath();
      ctx.fillStyle = 'rgba(45,226,230,0.15)';
      ctx.arc(node.x, node.y, finalSize * 2.5, 0, 2 * Math.PI, false);
      ctx.fill();
      ctx.closePath();
      ctx.restore();
    }

    // draw circle
    ctx.beginPath();
    ctx.fillStyle = nodeColor(node);
    ctx.arc(node.x, node.y, finalSize, 0, 2 * Math.PI, false);
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.2 / globalScale);
    ctx.strokeStyle = node.type === 'domain' ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.45)';
    ctx.stroke();

    // label visible for reasonable zooms
    if (globalScale >= 0.25) {
      const fontSize = Math.max(8, 9 / globalScale);
      ctx.font = `${node.type === 'domain' ? '600' : '400'} ${fontSize}px Sans-Serif`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = node.type === 'domain' ? 'rgba(0,0,0,0.9)' : 'rgba(225,235,240,0.95)';
      ctx.textAlign = 'center';
      
      // Position label below the node
      const labelOffsetY = finalSize + 15;
      ctx.fillText(label, node.x, node.y + labelOffsetY);
    }
  };

  // Build hierarchical radial layout with proper tree structure
  useEffect(() => {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.links)) return;
    
    const centerX = size.width / 2;
    const centerY = size.height / 2;
    const rootNode = data.nodes.find(n => n.type === 'domain');
    
    if (!rootNode) return;
    
    // Build hierarchy tree structure
    const buildHierarchy = () => {
      const nodeMap = new Map();
      data.nodes.forEach(node => {
        nodeMap.set(node.id, { ...node, children: [], level: 0 });
      });
      
      // Build parent-child relationships from links
      data.links.forEach(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        
        if (link.type === 'contains') {
          const parent = nodeMap.get(sourceId);
          const child = nodeMap.get(targetId);
          if (parent && child) {
            parent.children.push(child);
            child.parent = parent;
          }
        }
      });
      
      // Set levels based on distance from root
      const setLevels = (node, level = 0) => {
        node.level = level;
        node.children.forEach(child => setLevels(child, level + 1));
      };
      
      const root = nodeMap.get(rootNode.id);
      setLevels(root);
      
      return { root, nodeMap };
    };
    
    const { root, nodeMap } = buildHierarchy();
    
    // Position nodes in radial layout
    const positionNodes = () => {
      // Root at center (keep root fixed so layout orbits around it)
      root.x = centerX;
      root.y = centerY;
      root.fx = centerX;
      root.fy = centerY;
      
      // Position nodes level by level with better spacing
      const positionLevel = (nodes, level) => {
        if (nodes.length === 0) return;
        
        // Calculate radius - single ring for mind map effect
        const radius = 250; // Fixed radius for all nodes around center
        
        // Sort nodes by type for consistent positioning
        nodes.sort((a, b) => {
          const typeOrder = { subdomain: 1, directory: 2, endpoint: 3, file: 4 };
          return (typeOrder[a.type] || 5) - (typeOrder[b.type] || 5);
        });
        
        // Add angular spacing between nodes to prevent overlap
        const totalAngle = 2 * Math.PI;
        const anglePerNode = totalAngle / nodes.length;
        
        nodes.forEach((node, index) => {
          const angle = anglePerNode * index;
          
          // Set initial position but DON'T fix it - let physics take over
          node.x = centerX + radius * Math.cos(angle);
          node.y = centerY + radius * Math.sin(angle);
          // Don't set fx/fy - let physics move the nodes
        });
      };
      
      // Group all non-root nodes together for single ring layout
      const allNonRootNodes = [];
      nodeMap.forEach(node => {
        if (node.level > 0) { // Skip root (level 0)
          allNonRootNodes.push(node);
        }
      });
      
      // Position all non-root nodes in a single ring around the center
      positionLevel(allNonRootNodes, 1);
    };
    
    positionNodes();
    
    // Update the original data nodes with new positions
    data.nodes.forEach(node => {
      const hierarchyNode = nodeMap.get(node.id);
      if (hierarchyNode) {
        node.x = hierarchyNode.x;
        node.y = hierarchyNode.y;
        // Only fix the root domain; let others move with physics
        if (hierarchyNode.type === 'domain') {
          node.fx = hierarchyNode.fx;
          node.fy = hierarchyNode.fy;
        } else {
          node.fx = undefined;
          node.fy = undefined;
        }
        node.level = hierarchyNode.level;
      }
    });
    
    // Enable physics forces with mind map-friendly settings
    if (fgRef.current) {
      // Weaker repulsion to keep nodes closer to center
      const charge = forceManyBody().strength(-30);
      
      // Collision detection to prevent overlap
      const collide = forceCollide().radius(20).strength(0.8);
      
      // Link force to pull connected nodes together
      const linkForce = forceLink()
        .id(n => n.id)
        .distance(80) // Shorter distance for tighter layout
        .strength(0.6); // Stronger links to maintain structure

      fgRef.current.d3Force('charge', charge);
      fgRef.current.d3Force('collide', collide);
      fgRef.current.d3Force('link', linkForce);
      fgRef.current.d3ReheatSimulation && fgRef.current.d3ReheatSimulation();
    }
  }, [data, size]);

  // Keep physics enabled; when data changes, gently reheat the simulation
  useEffect(() => {
    if (fgRef.current && fgRef.current.d3ReheatSimulation) {
      fgRef.current.d3ReheatSimulation();
    }
  }, [data]);

  // Remove references to 'spacing' as it is no longer defined
  useEffect(() => {
    prevSpacingRef.current = null;
    try { fgRef.current && fgRef.current.d3ReheatSimulation && fgRef.current.d3ReheatSimulation(); } catch (e) {}
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Zoom Controls */}
      <div style={{
        position: 'absolute',
        top: 20,
        left: 20,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}>
        <button
          onClick={() => {
            if (fgRef.current) {
              const currentZoom = fgRef.current.zoom();
              fgRef.current.zoom(currentZoom * 1.5, 300);
            }
          }}
          style={{
            width: '40px',
            height: '40px',
            border: 'none',
            borderRadius: '6px',
            background: 'rgba(31, 41, 55, 0.9)',
            color: 'white',
            cursor: 'pointer',
            fontSize: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Zoom In"
        >
          +
        </button>
        <button
          onClick={() => {
            if (fgRef.current) {
              const currentZoom = fgRef.current.zoom();
              fgRef.current.zoom(currentZoom / 1.5, 300);
            }
          }}
          style={{
            width: '40px',
            height: '40px',
            border: 'none',
            borderRadius: '6px',
            background: 'rgba(31, 41, 55, 0.9)',
            color: 'white',
            cursor: 'pointer',
            fontSize: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Zoom Out"
        >
          −
        </button>
        <button
          onClick={() => {
            if (fgRef.current && fgRef.current.zoomToFit) {
              fgRef.current.zoomToFit(400, 50);
            }
          }}
          style={{
            width: '40px',
            height: '40px',
            border: 'none',
            borderRadius: '6px',
            background: 'rgba(31, 41, 55, 0.9)',
            color: 'white',
            cursor: 'pointer',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Fit to View"
        >
          ⌂
        </button>
      </div>
      
      <ForceGraph2D
        ref={fgRef}
        width={size.width}
        height={size.height}
        graphData={data}
        nodeColor={nodeColor}
        nodeLabel={node => `${node.type}: ${node.value}`}
        onNodeClick={handleNodeClick}
        nodeVal={n => 8}
        
        // Link styling for relationships
        linkWidth={(link) => {
          // Check if link is part of highlighted path
          const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
          const targetId = typeof link.target === 'object' ? link.target.id : link.target;
          const linkKey = `${sourceId}~${targetId}`;
          return pathLinks.current.has(linkKey) ? 4 : 2;
        }}
        
        linkColor={(link) => {
          // Check if link is part of highlighted path
          const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
          const targetId = typeof link.target === 'object' ? link.target.id : link.target;
          const linkKey = `${sourceId}~${targetId}`;
          
          if (pathLinks.current.has(linkKey)) {
            return 'rgba(45,226,230,0.9)'; // Bright cyan for highlighted paths
          }
          
          // Color links by relationship type
          switch(link.type) {
            case 'contains': return 'rgba(59,130,246,0.7)'; // blue
            case 'related': return 'rgba(251,146,60,0.7)'; // orange
            case 'api_related': return 'rgba(45,226,230,0.7)'; // cyan
            case 'security_concern': return 'rgba(239,68,68,0.7)'; // red
            case 'configures': return 'rgba(34,197,94,0.7)'; // green
            case 'mirrors': return 'rgba(168,85,247,0.7)'; // purple
            case 'redirect_to': return 'rgba(245,158,11,0.7)'; // yellow
            default: return 'rgba(156,163,175,0.5)'; // gray
          }
        }}
        
        linkDirectionalArrowLength={6}
        linkDirectionalArrowRelPos={0.9}
        linkDirectionalArrowColor={(link) => {
          const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
          const targetId = typeof link.target === 'object' ? link.target.id : link.target;
          const linkKey = `${sourceId}~${targetId}`;
          
          if (pathLinks.current.has(linkKey)) {
            return 'rgba(45,226,230,1)'; // Bright cyan for highlighted paths
          }
          
          switch(link.type) {
            case 'contains': return 'rgba(59,130,246,0.9)'; 
            case 'related': return 'rgba(251,146,60,0.9)';
            case 'api_related': return 'rgba(45,226,230,0.9)';
            case 'security_concern': return 'rgba(239,68,68,0.9)';
            case 'configures': return 'rgba(34,197,94,0.9)';
            case 'mirrors': return 'rgba(168,85,247,0.9)';
            case 'redirect_to': return 'rgba(245,158,11,0.9)';
            default: return 'rgba(156,163,175,0.7)';
          }
        }}
        
        linkLabel={link => `${link.type || 'connection'}`}
        
        nodeCanvasObject={nodeCanvasObject}
      />
    </div>
  );
};
