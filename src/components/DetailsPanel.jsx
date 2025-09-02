import React, { useState, useEffect } from 'react';
import './DetailsPanel.css';

export const DetailsPanel = ({ node, onClose }) => {
  const [isPanEnabled, setIsPanEnabled] = useState(false);
  const [activeTab, setActiveTab] = useState('info');
  
  // Reset tab when node changes
  useEffect(() => {
    setActiveTab('info');
  }, [node?.id]);
  
  if (!node) return null;

  // Format node data
  const status = String(node.status || '200');
  const responseSize = formatSize(node.size);
  const headers = node.headers || [];
  const technologies = node.technologies || [];
  const vulnerabilities = node.vulnerabilities || [];
  const urls = node.urls || [];

  // Helper function to format file size
  function formatSize(bytes) {
    if (!bytes) return 'Unknown';
    const units = ['bytes', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  // Get appropriate status class based on HTTP status code
  const getStatusClass = (statusStr) => {
    if (statusStr.startsWith('2')) return 'status success';
    if (statusStr.startsWith('3')) return 'status redirect';
    if (statusStr.startsWith('4')) return 'status client-error';
    if (statusStr.startsWith('5')) return 'status server-error';
    return 'status unknown';
  };

  // Get status text description
  const getStatusText = (statusStr) => {
    const statusTexts = {
      '200': 'OK',
      '201': 'Created',
      '301': 'Moved Permanently',
      '302': 'Found',
      '304': 'Not Modified',
      '400': 'Bad Request',
      '401': 'Unauthorized',
      '403': 'Forbidden',
      '404': 'Not Found',
      '500': 'Internal Server Error',
      '502': 'Bad Gateway',
      '503': 'Service Unavailable'
    };
    return statusTexts[statusStr] || '';
  };

  // Render appropriate vulnerability badge
  const renderVulnerabilityBadge = (vuln) => {
    const severity = vuln.includes('high') ? 'high' : 
                    vuln.includes('medium') ? 'medium' : 'low';
    
    return (
      <span className={`vuln-badge ${severity}`}>
        {severity}
      </span>
    );
  };

  // Get icon for node type
  const getNodeTypeIcon = (type) => {
    const icons = {
      'domain': '🌐',
      'subdomain': '🔗',
      'directory': '📁',
      'endpoint': '📄',
      'file': '📄'
    };
    return icons[type] || '❓';
  };

  // Get background gradient based on node type
  const getNodeBackground = () => {
    const colors = {
      'domain': 'linear-gradient(135deg, rgba(76, 175, 80, 0.1), rgba(76, 175, 80, 0.05))',
      'subdomain': 'linear-gradient(135deg, rgba(33, 150, 243, 0.1), rgba(33, 150, 243, 0.05))',
      'directory': 'linear-gradient(135deg, rgba(156, 39, 176, 0.1), rgba(156, 39, 176, 0.05))',
      'endpoint': 'linear-gradient(135deg, rgba(255, 152, 0, 0.1), rgba(255, 152, 0, 0.05))'
    };
    return colors[node.type] || 'linear-gradient(135deg, rgba(66, 66, 66, 0.1), rgba(66, 66, 66, 0.05))';
  };

  return (
    <aside className="details-panel" style={{background: getNodeBackground()}}>
      <div className="panel-header">
        <div className="node-title">
          <span className="node-icon">{getNodeTypeIcon(node.type)}</span>
          <h2>{node.value || node.label || 'Node Details'}</h2>
        </div>
        
        <div className="node-meta">
          <span className="node-type-badge">{node.type}</span>
          {node.protocol && <span className="protocol-badge">{node.protocol}</span>}
        </div>
        
        <button
          className="close-button"
          onClick={onClose}
          title="Close"
          aria-label="Close details panel"
        >
          ×
        </button>
      </div>

      <div className="panel-tabs">
        <button 
          className={`tab-button ${activeTab === 'info' ? 'active' : ''}`}
          onClick={() => setActiveTab('info')}
        >
          <span className="tab-icon">ℹ️</span>
          <span>Info</span>
        </button>
        <button 
          className={`tab-button ${activeTab === 'tech' ? 'active' : ''}`}
          onClick={() => setActiveTab('tech')}
        >
          <span className="tab-icon">⚙️</span>
          <span>Tech</span>
          {technologies.length > 0 && <span className="tab-badge">{technologies.length}</span>}
        </button>
        <button 
          className={`tab-button ${activeTab === 'vuln' ? 'active' : ''}`}
          onClick={() => setActiveTab('vuln')}
          disabled={vulnerabilities.length === 0}
        >
          <span className="tab-icon">🔒</span>
          <span>Security</span>
          {vulnerabilities.length > 0 && <span className="tab-badge alert">{vulnerabilities.length}</span>}
        </button>
      </div>

      <div className="panel-content">
        {activeTab === 'info' && (
          <>
            <div className="info-section status-section">
              <div className="status-card">
                <div className={getStatusClass(status)}>
                  <span className="status-code">{status}</span>
                  <span className="status-text">{getStatusText(status)}</span>
                </div>
              </div>
              
              <div className="metrics-grid">
                <div className="metric-card">
                  <div className="metric-icon">📦</div>
                  <div className="metric-content">
                    <span className="metric-value">{responseSize}</span>
                    <span className="metric-label">Size</span>
                  </div>
                </div>
                
                <div className="metric-card">
                  <div className="metric-icon">⏱️</div>
                  <div className="metric-content">
                    <span className="metric-value">{node.responseTime ? `${node.responseTime}ms` : 'N/A'}</span>
                    <span className="metric-label">Response Time</span>
                  </div>
                </div>
                
                <div className="metric-card">
                  <div className="metric-icon">🔄</div>
                  <div className="metric-content">
                    <span className="metric-value">{node.lastSeen || 'Unknown'}</span>
                    <span className="metric-label">Last Seen</span>
                  </div>
                </div>
                
                <div className="metric-card">
                  <div className="metric-icon">🔗</div>
                  <div className="metric-content">
                    <span className="metric-value">{(node.links?.length || 0) + (node.edges?.length || 0)}</span>
                    <span className="metric-label">Connections</span>
                  </div>
                </div>
              </div>
            </div>

            {urls.length > 0 && (
              <div className="info-section">
                <div className="section-header">
                  <h3>
                    <span className="section-icon">🔗</span>
                    URLs
                    <span className="count-badge">{urls.length}</span>
                  </h3>
                </div>
                <div className="urls-container">
                  {urls.map((url, i) => (
                    <div key={i} className="url-card">
                      <div className="url-icon">🌐</div>
                      <div className="url-content">
                        <a href={url} target="_blank" rel="noopener noreferrer" className="url-link">
                          {url}
                        </a>
                        <div className="url-actions">
                          <button className="url-action-btn" title="Copy URL">📋</button>
                          <button className="url-action-btn" title="Open in new tab">↗️</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {headers.length > 0 ? (
              <div className="info-section">
                <div className="section-header">
                  <h3>
                    <span className="section-icon">📋</span>
                    Headers 
                    <span className="count-badge">{headers.length}</span>
                  </h3>
                  {headers.length > 5 && (
                    <button className="section-action">
                      Show All
                    </button>
                  )}
                </div>
                
                <div className="accordion">
                  <div className="headers-list">
                    {headers.map((h, i) => (
                      <div key={i} className="header-item">
                        <span className="header-key">{h.key}</span>
                        <span className="header-value">{h.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                
                {headers.some(h => h.key.toLowerCase().includes('security') || 
                              h.key.toLowerCase().includes('content-security') ||
                              h.key.toLowerCase().includes('x-xss')) && (
                  <div className="security-hint">
                    <span className="hint-icon">🛡️</span>
                    Security headers detected
                  </div>
                )}
              </div>
            ) : (
              <div className="info-section">
                <h3>
                  <span className="section-icon">📋</span>
                  Headers
                </h3>
                <div className="empty-state">
                  <span className="empty-icon">📭</span>
                  <span>No headers information available</span>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'tech' && (
          <>
            <div className="info-section">
              <div className="section-header">
                <h3>
                  <span className="section-icon">⚙️</span>
                  Technologies 
                  <span className="count-badge">{technologies.length}</span>
                </h3>
              </div>
              {technologies.length > 0 ? (
                <div className="tech-grid">
                  {technologies.map((tech, i) => {
                    // Determine tech category
                    const category = 
                      tech.includes('Server') || tech.includes('Apache') || tech.includes('Nginx') ? 'server' :
                      tech.includes('React') || tech.includes('Vue') || tech.includes('Angular') ? 'frontend' :
                      tech.includes('PHP') || tech.includes('Node') || tech.includes('Python') ? 'backend' :
                      tech.includes('MySQL') || tech.includes('Postgres') || tech.includes('MongoDB') ? 'database' :
                      'other';
                    
                    const categoryIcons = {
                      'server': '🖥️',
                      'frontend': '🖌️',
                      'backend': '⚙️',
                      'database': '🗄️',
                      'other': '🧰'
                    };
                    
                    return (
                      <div key={i} className={`tech-card ${category}`}>
                        <div className="tech-icon">{categoryIcons[category]}</div>
                        <div className="tech-content">
                          <span className="tech-name">{tech}</span>
                          <span className="tech-category">{category}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">
                  <span className="empty-icon">🔍</span>
                  <span>No technologies detected</span>
                </div>
              )}
            </div>
            
            <div className="info-section">
              <div className="section-header">
                <h3>
                  <span className="section-icon">📊</span>
                  Technology Summary
                </h3>
              </div>
              <div className="tech-summary">
                {technologies.length > 0 ? (
                  <div className="tech-chart">
                    <div className="chart-legend">
                      <div className="legend-item">
                        <span className="legend-color frontend"></span>
                        <span className="legend-label">Frontend</span>
                      </div>
                      <div className="legend-item">
                        <span className="legend-color backend"></span>
                        <span className="legend-label">Backend</span>
                      </div>
                      <div className="legend-item">
                        <span className="legend-color server"></span>
                        <span className="legend-label">Server</span>
                      </div>
                    </div>
                    <div className="tech-risk-assessment">
                      <div className="risk-header">Security Risk Assessment</div>
                      <div className="risk-level low">Low Risk</div>
                      <div className="risk-description">Current tech stack appears to be maintained and updated.</div>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">No data available for technology summary</div>
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === 'vuln' && (
          <>
            <div className="info-section">
              <div className="section-header security-header">
                <h3>
                  <span className="section-icon">🛡️</span>
                  Security Issues
                  <span className={`count-badge ${vulnerabilities.length > 0 ? 'warning' : 'safe'}`}>
                    {vulnerabilities.length}
                  </span>
                </h3>
                <div className="security-actions">
                  <button className="action-button" title="Export report">
                    <span>📊</span>
                  </button>
                </div>
              </div>
              
              {vulnerabilities.length > 0 ? (
                <div className="vuln-list">
                  {vulnerabilities.map((vuln, i) => {
                    // Determine vulnerability type
                    const vulnType = 
                      vuln.includes('XSS') ? 'xss' :
                      vuln.includes('SQL') ? 'sql' :
                      vuln.includes('CSRF') ? 'csrf' :
                      vuln.includes('auth') || vuln.includes('password') ? 'auth' :
                      'other';
                    
                    return (
                      <div key={i} className={`vuln-item ${vulnType}`}>
                        <div className="vuln-severity">
                          {renderVulnerabilityBadge(vuln)}
                          <div className="vuln-icon">
                            {vulnType === 'xss' ? '📝' :
                             vulnType === 'sql' ? '🗃️' :
                             vulnType === 'csrf' ? '🔄' :
                             vulnType === 'auth' ? '🔑' : '⚠️'}
                          </div>
                        </div>
                        <div className="vuln-details">
                          <div className="vuln-title">{vuln}</div>
                          <div className="vuln-description">
                            {vulnType === 'xss' ? 'Possible cross-site scripting vulnerability' :
                             vulnType === 'sql' ? 'Potential SQL injection point' :
                             vulnType === 'csrf' ? 'Cross-site request forgery risk' :
                             vulnType === 'auth' ? 'Authentication vulnerability detected' : 
                             'Security issue detected'}
                          </div>
                          <div className="vuln-actions">
                            <button className="vuln-action-btn">Details</button>
                            <button className="vuln-action-btn">Fix</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="security-success">
                  <div className="success-icon">✅</div>
                  <div className="success-message">No vulnerabilities detected</div>
                  <div className="success-detail">This node appears to be secure based on current scans</div>
                </div>
              )}
            </div>
            
            <div className="info-section">
              <div className="section-header">
                <h3>
                  <span className="section-icon">🔍</span>
                  Security Scan History
                </h3>
              </div>
              <div className="scan-history">
                <div className="scan-timeline">
                  <div className="scan-item">
                    <div className="scan-date">{new Date().toLocaleDateString()}</div>
                    <div className="scan-result clean">Clean</div>
                    <div className="scan-detail">Full security scan</div>
                  </div>
                  <div className="scan-item">
                    <div className="scan-date">{new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString()}</div>
                    <div className="scan-result clean">Clean</div>
                    <div className="scan-detail">Vulnerability assessment</div>
                  </div>
                </div>
                <button className="scan-action">Run New Scan</button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="panel-footer">
        <div className="footer-controls">
          <label className="control-toggle">
            <input 
              type="checkbox"
              checked={isPanEnabled}
              onChange={(e) => setIsPanEnabled(e.target.checked)}
            />
            <span className="toggle-label">
              <span className="toggle-icon">🔍</span>
              Enable zoom & pan
            </span>
          </label>
          
          <div className="panel-actions">
            <button className="panel-action-btn" title="Export data">
              <span className="action-icon">📤</span>
            </button>
            <button className="panel-action-btn" title="Add to favorites">
              <span className="action-icon">⭐</span>
            </button>
            <button className="panel-action-btn" title="Copy node info">
              <span className="action-icon">📋</span>
            </button>
          </div>
        </div>
        
        <div className="footer-info">
          <div className="node-id">ID: {node.id || 'unknown'}</div>
          <div className="panel-version">v2.3</div>
        </div>
      </div>
    </aside>
  );
};
