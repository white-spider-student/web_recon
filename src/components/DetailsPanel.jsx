import React, { useEffect, useMemo, useState, useRef } from 'react';
import './DetailsPanel.css';

const STATUS_MAP = {
  '2': { label: 'OK', tone: 'good' },
  '3': { label: 'Redirect', tone: 'warm' },
  '4': { label: 'Client Error', tone: 'warn' },
  '5': { label: 'Server Error', tone: 'alert' }
};

const formatBytes = (bytes) => {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return 'Unknown';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatStatus = (status) => {
  const normalized = String(status || '').trim() || '200';
  const group = normalized[0];
  const { label, tone } = STATUS_MAP[group] || { label: 'Unknown', tone: 'neutral' };
  return { code: normalized, label, tone };
};

const extractHeaders = (node) => {
  if (!node) return [];
  if (Array.isArray(node.headers) && node.headers.length) {
    return node.headers.map(({ key, value }) => ({
      key: String(key || ''),
      value: value == null ? '' : String(value)
    }));
  }
  if (node.meta && node.meta.headers) {
    return Object.entries(node.meta.headers).map(([key, value]) => ({
      key: String(key || ''),
      value: value == null ? '' : String(value)
    }));
  }
  return [];
};

const extractTechnologies = (node) => {
  if (!node) return [];
  if (Array.isArray(node.technologies)) return node.technologies;
  if (node.meta && Array.isArray(node.meta.technologies)) return node.meta.technologies;
  return [];
};

const extractVulnerabilities = (node) => {
  if (!node) return [];
  if (Array.isArray(node.vulnerabilities)) return node.vulnerabilities;
  return [];
};

const iconForType = (type) => {
  switch (type) {
    case 'domain':
      return '🌐';
    case 'subdomain':
      return '🔗';
    case 'directory':
      return '📁';
    case 'endpoint':
      return '📄';
    default:
      return '🧩';
  }
};

export const DetailsPanel = ({ node, onClose }) => {
  const headers = useMemo(() => extractHeaders(node), [node]);
  const technologies = useMemo(() => extractTechnologies(node), [node]);
  const vulnerabilities = useMemo(() => extractVulnerabilities(node), [node]);

  const [showFullResponse, setShowFullResponse] = useState(false);
  const [activeTab, setActiveTab] = useState('headers');
  const [copyNotice, setCopyNotice] = useState('');
  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('detailsPanelWidth');
      const parsed = stored ? parseInt(stored, 10) : NaN;
      if (!Number.isNaN(parsed)) return Math.min(Math.max(parsed, 360), 960);
    }
    return 560; // default width
  });
  const minWidth = 360;
  const maxWidth = 960;
  const startDragRef = useRef({ active: false });

  // Expose panel width to CSS so the graph can reserve space on the right
  useEffect(() => {
    const w = node ? panelWidth : 0;
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--details-panel-width', `${w}px`);
    }
    return () => {
      // On unmount, clear the reservation to avoid stale margins
      if (typeof document !== 'undefined') {
        document.documentElement.style.setProperty('--details-panel-width', '0px');
      }
    };
  }, [panelWidth, node]);

  useEffect(() => {
    const handleMove = (e) => {
      if (!startDragRef.current.active) return;
      const newWidth = Math.min(Math.max(window.innerWidth - e.clientX, minWidth), maxWidth);
      setPanelWidth(newWidth);
    };
    const handleUp = () => {
      if (startDragRef.current.active) {
        startDragRef.current.active = false;
        window.localStorage.setItem('detailsPanelWidth', String(panelWidth));
        document.body.classList.remove('dp-resizing');
      }
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [panelWidth]);

  const beginResize = (e) => {
    e.preventDefault();
    startDragRef.current.active = true;
    document.body.classList.add('dp-resizing');
  };

  // Keep the selected node visible while resizing the panel
  useEffect(() => {
    try {
      if (node && window?.graphInstance?.focusOn) {
        window.graphInstance.focusOn(node.id, { zoom: 1.6, duration: 240 });
      }
    } catch (e) {
      // non-fatal; graph may not be ready
    }
  }, [panelWidth, node]);

  const resetWidth = () => {
    setPanelWidth(560);
    window.localStorage.setItem('detailsPanelWidth', '560');
  };

  useEffect(() => {
    setShowFullResponse(false);
  setActiveTab('headers');
  }, [node]);

  if (!node) return null;

  const statusInfo = formatStatus(node?.status);
  const responseTime = node?.responseTime ? `${node.responseTime} ms` : 'Unknown';
  const responseSize = formatBytes(node?.size);
  const lastSeen = node?.lastSeen || node?.timestamp || 'Unknown';
  const urls = Array.isArray(node?.urls) ? node.urls : [];
  const ipAddress = node?.ip || node?.meta?.ip || 'Unknown';
  const server = node?.server || node?.meta?.server || 'Unknown';
  const port = node?.port || node?.meta?.port || '—';
  const scheme = node?.protocol || node?.scheme || node?.meta?.scheme || '—';
  const fullPath = node?.fullLabel || node?.value || '';
  const scanFinishedAt = node?.scan_finished_at || node?.meta?.scan_finished_at || '';
  const getDisplayName = (nodeData) => {
    if (!nodeData) return 'Node details';
    if (nodeData.type === 'host') {
      return nodeData.hostname || nodeData.label || nodeData.id || 'Node details';
    }
    const candidate = nodeData.fullLabel || nodeData.value || '';
    if (typeof candidate === 'string' && candidate.trim()) {
      const cleaned = candidate.split('#')[0].split('?')[0];
      const parts = cleaned.split('/').filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
    return nodeData.label || nodeData.id || 'Node details';
  };
  const displayName = getDisplayName(node);
  const nodeType = node?.type || 'node';
  const totalConnections = (Array.isArray(node?.links) ? node.links.length : 0) +
    (Array.isArray(node?.edges) ? node.edges.length : 0);
  const copyFullPath = async () => {
    if (!fullPath) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullPath);
      } else {
        const ta = document.createElement('textarea');
        ta.value = fullPath;
        ta.setAttribute('readonly', 'true');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopyNotice('Copied');
      setTimeout(() => setCopyNotice(''), 1200);
    } catch (e) {
      setCopyNotice('Copy failed');
      setTimeout(() => setCopyNotice(''), 1200);
    }
  };

  const responseCandidates = [
    node?.raw,
    node?.response,
    node?.responseBody,
    node?.body,
    node?.meta?.raw,
    node?.meta?.rawResponse,
    node?.meta?.raw_response,
    node?.meta?.response,
    node?.meta?.responseBody,
    node?.meta?.response_body,
    node?.meta?.body,
    node?.meta?.payload
  ].filter((value) => typeof value === 'string' && value.trim().length > 0);

  const rawResponseText = responseCandidates.length
    ? responseCandidates[0].trim()
    : ((headers.length || statusInfo?.code) ? (() => {
      const lines = [];
      if (statusInfo?.code) {
        lines.push(`HTTP ${statusInfo.code} ${statusInfo.label}`);
      }
      headers.forEach(({ key, value }) => {
        lines.push(`${(key || 'Header')}: ${(value || '').trim()}`);
      });
      lines.push('');
      lines.push('-- body not captured --');
      return lines.join('\n');
    })() : '');

  const hasRawResponse = rawResponseText.trim().length > 0;

  // Tabs
  const tabs = [
    { key: 'headers', label: `HTTP Headers${headers.length ? ` (${headers.length})` : ''}` },
    { key: 'tech', label: 'Technologies' },
    { key: 'security', label: 'Security Findings' }
  ];

  return (
    <aside className="details-panel dp-panel" style={{ width: panelWidth }}>
      <div
        className="dp-resize-handle"
        onMouseDown={beginResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize details panel"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            setPanelWidth(w => Math.min(Math.max(w + 20, minWidth), maxWidth));
          } else if (e.key === 'ArrowRight') {
            setPanelWidth(w => Math.min(Math.max(w - 20, minWidth), maxWidth));
          } else if (e.key === 'Escape') {
            resetWidth();
          }
        }}
      />
      <div className="dp-header-section">
        <div className="dp-heading-line">
          <span className="dp-heading-icon" aria-hidden>{iconForType(nodeType)}</span>
          <span className="dp-heading-text">{nodeType === 'domain' ? 'Domain' : 'Node'}: {displayName}</span>
          <button type="button" className="dp-close" onClick={onClose} aria-label="Close details panel">×</button>
        </div>
        <div className="dp-status-line">
          <span className={`dp-status-pill ${statusInfo.tone}`}>{statusInfo.code} {statusInfo.label}</span>
          <span className="dp-status-meta">Response Size: {responseSize}</span>
          <span className="dp-status-meta">Last Seen: {lastSeen}</span>
          <button type="button" className="dp-reset-width" onClick={resetWidth} title="Reset width">Reset</button>
        </div>
      </div>

      <div className="dp-meta-cards">
        <div className="dp-meta-card"><div className="dp-meta-label">🖥 Server</div><div className="dp-meta-value" title={server}>{server}</div></div>
        <div className="dp-meta-card"><div className="dp-meta-label">🌍 IP Address</div><div className="dp-meta-value" title={ipAddress}>{ipAddress}</div></div>
        <div className="dp-meta-card"><div className="dp-meta-label">⚡ Response Time</div><div className="dp-meta-value">{responseTime}</div></div>
        <div className="dp-meta-card"><div className="dp-meta-label">🔌 Connections</div><div className="dp-meta-value">{totalConnections}</div></div>
        {scanFinishedAt ? (
          <div className="dp-meta-card"><div className="dp-meta-label">⏱ Scan Completed</div><div className="dp-meta-value" title={scanFinishedAt}>{scanFinishedAt}</div></div>
        ) : null}
        {fullPath ? (
          <div className="dp-meta-card dp-meta-card--full">
            <div className="dp-meta-label">🧭 Full Path</div>
            <div className="dp-meta-value dp-meta-value--full" title={fullPath}>{fullPath}</div>
            <button type="button" className="dp-copy-btn" onClick={copyFullPath} title="Click to copy">Copy</button>
            {copyNotice ? <div className="dp-copy-note">{copyNotice}</div> : null}
          </div>
        ) : null}
      </div>

      <nav className="dp-tabs" role="tablist">
        {tabs.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            className={`dp-tab ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >{t.label}</button>
        ))}
      </nav>

      <div className="dp-tab-content">
        {/* Overview tab removed per user request */}

        {activeTab === 'headers' && (
          <div className="dp-headers-tab">
            {headers.length ? (
              <div className="dp-header-list">
                {headers.map(({ key, value }) => {
                  const headerKey = key || 'Unnamed header';
                  const headerValue = value || '—';
                  return (
                    <div className="dp-header-item" key={`${headerKey}-${headerValue}`}>
                      <div className="dp-header-top"><span className="dp-header-name" title={headerKey}>{headerKey}</span></div>
                      <span className="dp-header-value" title={headerValue}>{headerValue}</span>
                    </div>
                  );
                })}
              </div>
            ) : <div className="dp-empty">No headers detected</div>}
            {hasRawResponse && showFullResponse && <pre className="dp-response-body" aria-label="HTTP response dump">{rawResponseText}</pre>}
            {hasRawResponse && (
              <button type="button" className="dp-ghost-button dp-response-toggle" onClick={() => setShowFullResponse(p=>!p)} aria-expanded={showFullResponse}>{showFullResponse ? 'Hide raw' : 'Show raw'}</button>
            )}
          </div>
        )}

        {activeTab === 'tech' && (
          <div className="dp-tech-tab">
            {technologies.length ? <ul className="dp-chip-list">{technologies.map(t => <li key={t}>{t}</li>)}</ul> : <div className="dp-empty">No technologies identified</div>}
          </div>
        )}

        {activeTab === 'security' && (
          <div className="dp-security-tab">
            {vulnerabilities.length ? <ul className="dp-list">{vulnerabilities.map((v,i)=><li key={i}>{v}</li>)}</ul> : <div className="dp-empty">No known vulnerabilities</div>}
          </div>
        )}
      </div>
    </aside>
  );
};
