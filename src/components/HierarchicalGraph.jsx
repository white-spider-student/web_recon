import React, { useRef, useEffect, useState, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { forceManyBody, forceCollide, forceLink, forceCenter, forceRadial } from 'd3-force';

export const HierarchicalGraph = ({ data, onNodeClick, highlightedNodes = [], highlightPath = [] }) => {
  const containerRef = useRef(null);
  const fgRef = useRef(null);
  const [size, setSize] = useState({ width: 800, height: 520 });
  const [levels, setLevels] = useState(new Map());

  // Compute node levels and update forces
  useEffect(() => {
    if (!data?.nodes?.length || !fgRef.current) return;

    const fg = fgRef.current;
    const rootNode = data.nodes.find(n => n.type === 'domain');
    if (!rootNode) return;

    // Assign hierarchical levels
    const newLevels = new Map();
    data.nodes.forEach(node => {
      switch(node.type) {
        case 'domain': newLevels.set(node.id, 0); break;
        case 'subdomain': newLevels.set(node.id, 1); break;
        case 'directory': newLevels.set(node.id, 2); break;
        case 'endpoint':
        case 'file': newLevels.set(node.id, 3); break;
        default: newLevels.set(node.id, 4);
      }
    });
    setLevels(newLevels);
      
      // Auto-expand root domain on initial load
      const rootNode = data.nodes.find(n => n.type === 'domain');
      if (rootNode) {
        setExpandedNodes(prev => new Set([...prev, rootNode.id]));
      }
    }
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
    setExpandedNodes(prev => new Set([...prev, ...nodesToExpand]));
  }, [data]);

  // Expose zoom function globally
  useEffect(() => {
    window.graphInstance = {
      zoomToNode: (nodeId, zoom = 2, duration = 800) => {
        const node = (data.nodes || []).find(n => n.id === nodeId);
        if (fgRef.current && node) {
          // Expand all parents to make node visible
          expandToNode(nodeId);
          setTimeout(() => {
            if (fgRef.current && node.x !== undefined && node.y !== undefined) {
              fgRef.current.centerAt(node.x, node.y, duration);
              fgRef.current.zoom(zoom, duration);
            }
          }, 100);
        }
      }
    };
  }, [data, expandToNode]);

  // Filter visible nodes based on hierarchy and expansion state
  const getVisibleNodes = useCallback(() => {
    if (!data || !data.nodes) return [];
    
    const visibleNodes = [];
    const visited = new Set();
    
    // Start with root domain
    const rootNode = data.nodes.find(n => n.type === 'domain');
    if (!rootNode) return data.nodes.slice(0, 10); // Fallback: show first 10 nodes
    
    const traverse = (nodeId, level = 0) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      
      const node = data.nodes.find(n => n.id === nodeId);
      if (!node) return;
      
      // Add level information for better layout
      node.level = level;
      visibleNodes.push(node);
      
      // If node is expanded, show its children
      if (expandedNodes.has(nodeId)) {
        const childLinks = data.links.filter(l => l.source === nodeId && l.type === 'contains');
        childLinks.forEach(link => {
          traverse(link.target, level + 1);
        });
      }
    };
    
    traverse(rootNode.id, 0);
    return visibleNodes;
  }, [data, expandedNodes]);
  
  // Get visible links based on visible nodes
  const getVisibleLinks = useCallback((visibleNodes) => {
    if (!data || !data.links) return [];
    
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
    return data.links.filter(l => 
      visibleNodeIds.has(l.source) && visibleNodeIds.has(l.target)
    );
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
    
    // Check if node has children
    const hasChildren = data?.links?.some(l => l.source === node.id && l.type === 'contains');
    
    if (hasChildren) {
      // Toggle expansion state
      setExpandedNodes(prev => {
        const newSet = new Set(prev);
        if (newSet.has(node.id)) {
          // Collapse: remove this node and all its descendants from expanded set
          const toRemove = new Set([node.id]);
          const findDescendants = (nodeId) => {
            const childLinks = data.links.filter(l => l.source === nodeId && l.type === 'contains');
            childLinks.forEach(link => {
              toRemove.add(link.target);
              findDescendants(link.target);
            });
          };
          findDescendants(node.id);
          
          toRemove.forEach(id => newSet.delete(id));
        } else {
          newSet.add(node.id);
        }
        return newSet;
      });
    }
    
    // Center on clicked node with animation
    setTimeout(() => {
      if (fgRef.current && node.x !== undefined && node.y !== undefined) {
        fgRef.current.centerAt(node.x, node.y, 600);
        fgRef.current.zoom(1.8, 600);
      }
    }, 200);
    
    // Notify parent component
    onNodeClick && onNodeClick(node, [node.id]);
  }, [data, onNodeClick]);
  
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
    if (!fgRef.current || !visibleNodes.length) return;
    
    // Enhanced force configuration for hierarchical layout
    const simulation = fgRef.current.d3Force;
    if (simulation) {
      // Radial force to organize by hierarchy level
      
      simulation('radial', forceRadial(
        (node) => (node.level || 0) * 120 + 50, // Distance from center based on level
        size.width / 2,
        size.height / 2
      ).strength(0.8));
      
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
      
      simulation('link', forceLink(visibleLinks)
        .id(d => d.id)
        .distance((link) => {
          const sourceNode = visibleNodes.find(n => n.id === link.source.id || n.id === link.source);
          const targetNode = visibleNodes.find(n => n.id === link.target.id || n.id === link.target);
          const levelDiff = Math.abs((sourceNode?.level || 0) - (targetNode?.level || 0));
          return 80 + levelDiff * 40; // Longer links between different levels
        })
        .strength(0.6)
      );
      
      simulation('center', forceCenter(size.width / 2, size.height / 2).strength(0.1));
    }
  }, [visibleNodes, visibleLinks, size, getNodeSize]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
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
          const isHighlighted = highlightPath.includes(String(link.source.id || link.source)) && 
                               highlightPath.includes(String(link.target.id || link.target));
          return isHighlighted ? 4 : 2;
        }}
        
        linkColor={(link) => {
          const isHighlighted = highlightPath.includes(String(link.source.id || link.source)) && 
                               highlightPath.includes(String(link.target.id || link.target));
          
          if (isHighlighted) return '#F59E0B';
          
          return link.type === 'contains' ? 'rgba(59, 130, 246, 0.6)' : 'rgba(156, 163, 175, 0.4)';
        }}
        
        linkDirectionalArrowLength={8}
        linkDirectionalArrowRelPos={0.9}
        linkDirectionalArrowColor={(link) => {
          const isHighlighted = highlightPath.includes(String(link.source.id || link.source)) && 
                               highlightPath.includes(String(link.target.id || link.target));
          return isHighlighted ? '#F59E0B' : 'rgba(59, 130, 246, 0.8)';
        }}
        
        // Performance optimizations
        cooldownTicks={100}
        onEngineStop={() => fgRef.current?.zoomToFit(400, 50)}
        
        // Custom node rendering for better visuals
        nodeCanvasObjectMode={() => 'after'}
        nodeCanvasObject={(node, ctx, globalScale) => {
          // Draw expansion indicator for nodes with children
          const hasChildren = data?.links?.some(l => l.source === node.id && l.type === 'contains');
          const isExpanded = expandedNodes.has(node.id);
          
          if (hasChildren) {
            const nodeRadius = getNodeSize(node);
            
            // Draw expansion indicator
            ctx.save();
            ctx.fillStyle = isExpanded ? '#10B981' : '#6B7280';
            ctx.font = `${Math.max(8, 12 / globalScale)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            const symbol = isExpanded ? '−' : '+';
            const symbolSize = nodeRadius * 0.6;
            
            ctx.fillRect(
              node.x - symbolSize / 2, 
              node.y + nodeRadius + 8 - symbolSize / 2, 
              symbolSize, 
              symbolSize
            );
            
            ctx.fillStyle = 'white';
            ctx.fillText(symbol, node.x, node.y + nodeRadius + 8);
            ctx.restore();
          }
          
          // Draw node level indicator
          if (node.level > 0) {
            ctx.save();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.font = `${Math.max(6, 8 / globalScale)}px Arial`;
            ctx.textAlign = 'center';
            ctx.fillText(`L${node.level}`, node.x, node.y - getNodeSize(node) - 15);
            ctx.restore();
          }
        }}
      />
      
      {/* Hierarchy Legend */}
      <div style={{
        position: 'absolute',
        top: 20,
        right: 20,
        background: 'rgba(31, 41, 55, 0.9)',
        color: 'white',
        padding: '12px',
        borderRadius: '8px',
        fontSize: '12px',
        backdropFilter: 'blur(4px)'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Node Types</div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
          <div style={{ width: '12px', height: '12px', backgroundColor: '#DC2626', borderRadius: '50%', marginRight: '8px' }}></div>
          <span>Target Domain</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
          <div style={{ width: '12px', height: '12px', backgroundColor: '#2563EB', borderRadius: '50%', marginRight: '8px' }}></div>
          <span>Subdomains</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
          <div style={{ width: '12px', height: '12px', backgroundColor: '#059669', borderRadius: '50%', marginRight: '8px' }}></div>
          <span>Directories</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ width: '12px', height: '12px', backgroundColor: '#EA580C', borderRadius: '50%', marginRight: '8px' }}></div>
          <span>Endpoints</span>
        </div>
      </div>
    </div>
  );
};
