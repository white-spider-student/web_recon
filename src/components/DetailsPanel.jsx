import React from 'react';
import './DetailsPanel.css';

export const DetailsPanel = ({ node, onClose }) => {
  if (!node) return null;

  // Convert status to string and handle default values
  const status = String(node.status || '200');
  const responseSize = node.size ? `${node.size} bytes` : 'Unknown';
  const headers = node.headers || [];
  const technologies = node.technologies || [];
  const vulnerabilities = node.vulnerabilities || [];

  const getStatusClass = (statusStr) => {
    if (statusStr.startsWith('2')) return 'status success';
    if (statusStr.startsWith('3')) return 'status redirect';
    if (statusStr.startsWith('4')) return 'status client-error';
    if (statusStr.startsWith('5')) return 'status server-error';
    return 'status unknown';
  };

  return (
    <aside className="details-panel">
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 12,
          right: 16,
          background: 'rgba(20,30,40,0.8)',
          color: '#fff',
          border: 'none',
          borderRadius: '50%',
          width: 32,
          height: 32,
          fontSize: 20,
          cursor: 'pointer',
          zIndex: 101
        }}
        title="Close"
        aria-label="Close details panel"
      >×</button>
      <h2 style={{ marginTop: 40 }}>Node Details</h2>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Status Code</div>
        <div className={getStatusClass(status)} style={{ marginTop: 6 }}>{status}</div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Response Size</div>
        <div style={{ marginTop: 6 }}>{responseSize}</div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Type</div>
        <div style={{ marginTop: 6 }}>{node.type || 'Unknown'}</div>
      </div>

      <div className="headers" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Headers</div>
        <ul style={{ marginTop: 6 }}> 
          {headers.map(h => (
            <li key={h.key} style={{ fontSize: 12, color: 'var(--text)' }}><strong style={{ color: 'var(--muted)' }}>{h.key}:</strong> {h.value}</li>
          ))}
        </ul>
      </div>

      <div className="technologies" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Technologies</div>
        <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
          {technologies.map((t,i) => (
            <span key={i} className="tech" style={{ color: 'var(--accent)', fontSize: 13 }}>{t}</span>
          ))}
        </div>
      </div>

      <div className="vulnerabilities" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Vulnerability Hints</div>
        <ul style={{ marginTop: 6 }}>
          {vulnerabilities.map((v, i) => (
            <li key={i} style={{ fontSize: 12, color: 'var(--text)' }}>🛈 {v}</li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 'auto', fontSize: 12, color: 'var(--muted)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" readOnly /> <span>Enable zoom & pan</span>
        </label>
      </div>
    </aside>
  );
};
