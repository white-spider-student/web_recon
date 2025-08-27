import React from 'react';

export const DetailsPanel = ({ node, onClose }) => {
  const status = node?.status || (String(node?.id || '').includes('adm') ? '403 Forbidden' : '200 OK');
  const responseSize = node?.responseSize || '2.4 KB';
  const headers = node?.headers || [
    { key: 'Content-Type', value: 'text/html' },
    { key: 'Content-Length', value: '2457' }
  ];
  const technologies = node?.technologies || ['Apache', 'React'];
  const vulnerabilities = node?.vulnerabilities || ['Open directory'];

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
        <div className={status.startsWith('200') ? 'status' : 'status error'} style={{ marginTop: 6 }}>{status}</div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Response Size</div>
        <div style={{ marginTop: 6 }}>{responseSize}</div>
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
