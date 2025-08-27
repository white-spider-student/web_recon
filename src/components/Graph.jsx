import React, { useRef, useEffect, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { forceManyBody, forceCollide, forceLink } from 'd3-force';

export const Graph = ({ data, onNodeClick, highlightedNodes = [], highlightPath = [] }) => {
  const containerRef = useRef(null);
  const fgRef = useRef(null);
  const prevSpacingRef = useRef(null);
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
  const [size, setSize] = useState({ width: 800, height: 520 });

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

  // color mapping for groups
  const nodeColor = (node) => {
    if (!node || !node.group) return '#bbb';
    switch (node.group) {
      case 'subdomain': return 'rgba(45,226,230,0.95)'; // cyan
      case 'directory': return 'rgba(59,130,246,0.95)'; // blue
      case 'endpoint': return 'rgba(251,146,60,0.95)'; // orange
      case 'domain': return 'rgba(45,226,230,0.95)';
      default: return '#bbb';
    }
  };

  // center/zoom to fit when data changes
  useEffect(() => {
    if (!fgRef.current || !data) return;
    try {
      setTimeout(() => {
        fgRef.current.zoomToFit && fgRef.current.zoomToFit(400, 20);
      }, 50);
    } catch (e) {}
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
    const label = node.id;
    const baseSize = Math.max(6, (node.val || 6));

    // animation progress based on when node was first seen
    const addedAt = nodesAddedAt.current.get(node.id) || Date.now();
    const age = Date.now() - addedAt;
    const dur = 900; // ms
    const t = Math.min(1, age / dur);
    // ease-out
    const ease = 1 - Math.pow(1 - t, 3);
    const sizeVal = Math.max(1, baseSize * (0.3 + 0.7 * ease));

    // highlight halo if node is highlighted
    if (typeof highlightedSet !== 'undefined' && highlightedSet.has(String(node.id))) {
      ctx.save();
      ctx.beginPath();
      ctx.fillStyle = 'rgba(45,226,230,0.08)';
      ctx.arc(node.x, node.y, sizeVal * 3.0, 0, 2 * Math.PI, false);
      ctx.fill();
      ctx.closePath();
      ctx.restore();
    }

    // draw circle
    ctx.beginPath();
    ctx.fillStyle = nodeColor(node);
    ctx.arc(node.x, node.y, sizeVal, 0, 2 * Math.PI, false);
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.2 / globalScale);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.stroke();

    // label visible for reasonable zooms; smaller and lighter (not bold)
    if (globalScale >= 0.28) {
      const fontSize = Math.max(9, 10 / globalScale);
      ctx.font = `400 ${fontSize}px Sans-Serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(225,235,240,0.88)';
      ctx.textAlign = 'center';
      // Offset label horizontally if node has a parent (to avoid overlap)
      let labelOffsetY = baseSize + 14 + fontSize / 2;
      let labelOffsetX = 0;
      if (node.group !== 'domain') {
        // If node is a grandchild, offset label to the right
        labelOffsetX = 18;
      }
      ctx.fillText(label, node.x + labelOffsetX, node.y - labelOffsetY);
    }
  };

  // Radial star layout: root in center, direct children in circle, their children outward
  useEffect(() => {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.links)) return;
    const centerX = size.width / 2;
    const centerY = size.height / 2;
    const rootIdx = data.nodes.findIndex(n => n.group === 'domain');
    if (rootIdx === -1) return;
    const root = data.nodes[rootIdx];
    // Find direct children of root
    const directChildren = data.links.filter(l => {
      return (l.source === root.id || (l.source && l.source.id === root.id));
    }).map(l => typeof l.target === 'object' ? l.target.id : l.target);
    // Place root in center
    root.x = centerX;
    root.y = centerY;
    root.fx = root.x;
    root.fy = root.y;
    // Place direct children in a circle around root, each with a unique sector
    const childRadius = Math.min(size.width, size.height) * 0.28;
    const sectorGap = Math.PI / 18; // larger gap between sectors
    directChildren.forEach((childId, i) => {
      // Assign each child a sector (angle range)
      const sectorSize = (2 * Math.PI) / directChildren.length;
      const sectorStart = sectorSize * i + sectorGap;
      const sectorEnd = sectorSize * (i + 1) - sectorGap;
      const angle = (sectorStart + sectorEnd) / 2;
      const childNode = data.nodes.find(n => n.id === childId);
      if (childNode) {
        childNode.x = centerX + childRadius * Math.cos(angle);
        childNode.y = centerY + childRadius * Math.sin(angle);
        childNode.fx = childNode.x;
        childNode.fy = childNode.y;
        // Find children of this child (grandchildren)
        let grandChildren = data.links.filter(l => {
          return (l.source === childNode.id || (l.source && l.source.id === childNode.id));
        }).map(l => typeof l.target === 'object' ? l.target.id : l.target);
        // Sort grandchildren by id for adjacency
        grandChildren = grandChildren.sort();
        // Minimum angular separation
        const minAngleSep = Math.PI / 32;
        // Increase radial distance for each grandchild to avoid overlap
        const baseGrandRadius = childRadius + 170;
        grandChildren.forEach((gId, j) => {
          // Spread grandchildren evenly within the parent's sector, with extra angle separation
          const gAngle = sectorStart + ((sectorEnd - sectorStart) * (j + 1) / (grandChildren.length + 1));
          // Offset angle if too close to previous
          const prevAngle = j > 0 ? sectorStart + ((sectorEnd - sectorStart) * (j) / (grandChildren.length + 1)) : null;
          const angleDiff = prevAngle ? Math.abs(gAngle - prevAngle) : minAngleSep;
          const finalAngle = angleDiff < minAngleSep ? gAngle + minAngleSep : gAngle;
          // Increase radius for each grandchild to avoid node collision
          const grandRadius = baseGrandRadius + (j * 18);
          const gNode = data.nodes.find(n => n.id === gId);
          if (gNode) {
            gNode.x = centerX + grandRadius * Math.cos(finalAngle);
            gNode.y = centerY + grandRadius * Math.sin(finalAngle);
            gNode.fx = gNode.x;
            gNode.fy = gNode.y;
          }
        });
      }
    });
    // Place all other nodes in a secondary ring if not already positioned
    data.nodes.forEach((node) => {
      if (typeof node.x !== 'number' || typeof node.y !== 'number') {
        const idx = data.nodes.indexOf(node);
        const angle = (2 * Math.PI * idx) / data.nodes.length;
        const radius = childRadius + 180;
        node.x = centerX + radius * Math.cos(angle);
        node.y = centerY + radius * Math.sin(angle);
        node.fx = node.x;
        node.fy = node.y;
      }
    });
    // Remove all forces so nodes stay fixed
    if (fgRef.current) {
      fgRef.current.d3Force('charge', null);
      fgRef.current.d3Force('collide', null);
      fgRef.current.d3Force('link', null);
      fgRef.current.d3ReheatSimulation && fgRef.current.d3ReheatSimulation();
    }
  }, [data, size]);

  // Apply dynamic forces to the graph
  useEffect(() => {
    if (fgRef.current) {
      fgRef.current.d3Force('charge', forceManyBody().strength(-120));
      fgRef.current.d3Force('collide', forceCollide(50));
      fgRef.current.d3Force('link', forceLink().distance(200).strength(0.9));
      fgRef.current.d3ReheatSimulation && fgRef.current.d3ReheatSimulation();
    }
  }, [data]);

  // Remove references to 'spacing' as it is no longer defined
  useEffect(() => {
    prevSpacingRef.current = null;
    try { fgRef.current && fgRef.current.d3ReheatSimulation && fgRef.current.d3ReheatSimulation(); } catch (e) {}
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <ForceGraph2D
        ref={fgRef}
        width={size.width}
        height={size.height}
        graphData={data}
        nodeLabel="id"
        nodeRelSize={6}
        nodeAutoColorBy={null}
        nodeColor={nodeColor}
        // color links lighter by default, path links stronger
        linkColor={(l) => {
          try {
            const a = typeof l.source === 'object' ? l.source.id : l.source;
            const b = typeof l.target === 'object' ? l.target.id : l.target;
            const isPath = pathLinks.current.has(`${a}~${b}`);
            if (isPath) return 'rgba(45,226,230,0.95)';
            return 'rgba(255,255,255,0.06)';
          } catch (e) { return 'rgba(255,255,255,0.06)'; }
        }}
        linkWidth={(l) => {
          try {
            const a = typeof l.source === 'object' ? l.source.id : l.source;
            const b = typeof l.target === 'object' ? l.target.id : l.target;
            const isPath = pathLinks.current.has(`${a}~${b}`);
            if (isPath) return 3;
            return 1;
          } catch (e) { return 1; }
        }}
        // animated directional particles along links
        linkDirectionalParticles={1}
        linkDirectionalParticleWidth={() => 1.2}
        linkDirectionalParticleColor={(l) => {
          try {
            const a = typeof l.source === 'object' ? l.source.id : l.source;
            const b = typeof l.target === 'object' ? l.target.id : l.target;
            return pathLinks.current.has(`${a}~${b}`) ? 'rgba(45,226,230,1)' : 'rgba(45,226,230,0.6)';
          } catch (e) { return 'rgba(45,226,230,0.6)'; }
        }}
      
        onNodeClick={handleNodeClick}
        d3AlphaDecay={0.08}
        d3VelocityDecay={0.7}
        enableNodeDrag={true}
        nodeCanvasObject={nodeCanvasObject}
        minZoom={0.4}
        maxZoom={4}
      />

    </div>
  );
};
