// Node styling configurations
const nodeStyles = {
  domain: {
    color: '#4CAF50',
    size: 12,
    label: 'Domain'
  },
  subdomain: {
    color: '#2196F3',
    size: 8,
    label: 'Subdomain'
  },
  directory: {
    color: '#9C27B0',
    size: 6,
    label: 'Directory'
  },
  endpoint: {
    color: '#FF9800',
    size: 4,
    label: 'Endpoint'
  },
  file: {
    color: '#F44336',
    size: 4,
    label: 'File'
  }
};

// Get basic node style
export const getNodeStyle = (type) => {
  return nodeStyles[type] || nodeStyles.file;
};

// Get node color with state
export const getNodeColorWithState = (node, isHighlighted, isSimilar) => {
  const baseStyle = getNodeStyle(node.type);
  if (isHighlighted) return '#FFD700'; // Highlighted in gold
  if (isSimilar) return '#00CED1'; // Similar in turquoise
  return baseStyle.color;
};

// Get node size
export const getNodeSize = (type) => {
  const style = getNodeStyle(type);
  return style.size;
};

// Get node label
export const getNodeLabel = (type) => {
  const style = getNodeStyle(type);
  return style.label;
};
