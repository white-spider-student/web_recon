import React, { useRef, useEffect, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { forceManyBody, forceCollide, forceLink, forceCenter, forceRadial } from 'd3-force';
import './Graph.css';

export const Graph = ({ data, onNodeClick, highlightedNodes = [], similarNodes = [] }) => {
  const containerRef = useRef(null);
  const fgRef = useRef(null);
  const [size, setSize] = useState({ width: 800, height: 520 });
  const nodesAddedAt = useRef(new Map());

  // Build lookup sets for highlights
  const highlightedSet = new Set(highlightedNodes.map(String));
  const similarNodesSet = new Set(similarNodes.map(String));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    
    const resize = () => {
      const r = el.getBoundingClientRect();
      setSize({ 
        width: Math.max(200, Math.floor(r.width)), 
        height: Math.max(200, Math.floor(r.height)) 
      });
    };
    
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Configure forces
  useEffect(() => {
    if (!fgRef.current || !data?.nodes?.length) return;

    const fg = fgRef.current;
    const rootNode = data.nodes.find(n => n.type === 'domain');
    if (!rootNode) return;

    // Center force
    fg.d3Force('center', forceCenter(size.width / 2, size.height / 2).strength(0.05));

    // Charge force
    fg.d3Force('charge', forceManyBody().strength(node => 
      node.id === rootNode.id ? -1000 : -500
    ));

    // Link force
    fg.d3Force('link', forceLink()
      .id(d => d.id)
      .distance(link => {
        const isRootLink = link.source.id === rootNode.id || link.target.id === rootNode.id;
        return isRootLink ? 150 : 80;
      })
      .strength(0.2));

    // Radial force
    fg.d3Force('radial', forceRadial(
      node => node.id === rootNode.id ? 0 : 200,
      size.width / 2,
      size.height / 2
    ).strength(node => node.id === rootNode.id ? 0.8 : 0.1));

    // Collision force
    fg.d3Force('collision', forceCollide(20));

    // Pin root node
    rootNode.fx = size.width / 2;
    rootNode.fy = size.height / 2;
  }, [data, size.width, size.height]);

  // Zoom controls
  const handleZoom = (type) => {
    if (!fgRef.current) return;
    
    const fg = fgRef.current;
    const currentZoom = fg.zoom();
    
    switch(type) {
      case 'in':
        fg.zoom(currentZoom * 1.5, 400);
        break;
      case 'out':
        fg.zoom(currentZoom / 1.5, 400);
        break;
      case 'home':
        fg.zoomToFit(200, 1000);
        break;
      default:
        break;
    }
  };

  // Handle node clicks - zoom to clicked node
  const handleNodeClick = (node) => {
    if (!node || !fgRef.current?.centerAt) return;
    fgRef.current.centerAt(node.x, node.y, 600);
    fgRef.current.zoom(2.0, 600);
    onNodeClick?.(node, [node.id]);
  };

  // Get node color based on type
  const getNodeColor = (node) => {
    if (!node?.type) return '#bbb';
    switch(node.type) {
      case 'domain': return 'rgba(255,255,255,0.95)';
      case 'subdomain': return 'rgba(45,226,230,0.95)';
      case 'directory': return 'rgba(59,130,246,0.95)';
      case 'endpoint':
      case 'file': return 'rgba(251,146,60,0.95)';
      default: return '#bbb';
    }
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div className="graph-controls">
        <button onClick={() => handleZoom('in')} title="Zoom In">+</button>
        <button onClick={() => handleZoom('out')} title="Zoom Out">−</button>
        <button onClick={() => handleZoom('home')} title="Reset View" className="home-button">⌂</button>
      </div>
      <ForceGraph2D
        ref={fgRef}
        graphData={data}
        dagMode="radialout"
        dagLevelDistance={100}
        nodeLabel={node => node.label || node.id}
        nodeRelSize={6}
        linkColor={link => {
          const sourceId = String(typeof link.source === 'object' ? link.source.id : link.source);
          const targetId = String(typeof link.target === 'object' ? link.target.id : link.target);
          const isHighlighted = highlightedSet.has(sourceId) || highlightedSet.has(targetId);
          const isSimilar = similarNodesSet.has(sourceId) || similarNodesSet.has(targetId);
          
          if (isHighlighted) return 'rgba(45,226,230,0.6)';
          if (isSimilar) return 'rgba(251,146,60,0.6)';
          return 'rgba(255,255,255,0.2)';
        }}
        linkWidth={link => {
          const sourceId = String(typeof link.source === 'object' ? link.source.id : link.source);
          const targetId = String(typeof link.target === 'object' ? link.target.id : link.target);
          const isHighlighted = highlightedSet.has(sourceId) || highlightedSet.has(targetId);
          const isSimilar = similarNodesSet.has(sourceId) || similarNodesSet.has(targetId);
          
          return isHighlighted || isSimilar ? 2 : 1;
        }}
        onNodeClick={handleNodeClick}
        width={size.width}
        height={size.height}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const label = node.label || node.id;
          const fontSize = node.type === 'domain' ? 14 : 12;
          ctx.font = `${fontSize}px Arial`;
          const nodeColor = getNodeColor(node);
          const isHighlighted = highlightedSet.has(String(node.id));
          const isSimilar = similarNodesSet.has(String(node.id));
          const radius = 6;

          // Draw glow effect for highlighted nodes
          if (isHighlighted) {
            const glowSize = 15;
            // Skip if node positions are not yet finite
            if (!isFinite(node.x) || !isFinite(node.y)) return;
            const gradient = ctx.createRadialGradient(
              node.x, node.y, radius,
              node.x, node.y, glowSize
            );
            gradient.addColorStop(0, nodeColor);
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            
            ctx.beginPath();
            ctx.arc(node.x, node.y, glowSize, 0, 2 * Math.PI, false);
            ctx.fillStyle = gradient;
            ctx.fill();
          }

          // Draw the node
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
          ctx.fillStyle = nodeColor;
          ctx.fill();
          
          // Add a subtle ring for highlighted nodes
          if (isHighlighted) {
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          // Draw text
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#fff';
          ctx.fillText(label, node.x, node.y + 8 + fontSize/2);
        }}
      />
    </div>
  );
};
