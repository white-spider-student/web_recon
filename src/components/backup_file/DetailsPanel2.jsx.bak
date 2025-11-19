import React, { useState, useEffect } from 'react';
import './DetailsPanel.css';

// Defensive DetailsPanel: supports node.headers (array) or node.meta.headers (object),
// and node.technologies or node.meta.technologies. Exports both named and default.
export const DetailsPanel = ({ node, onClose }) => {
	const [activeTab, setActiveTab] = useState('info');
	const [showRaw, setShowRaw] = useState(false);
	const [viewMode, setViewMode] = useState('compact'); // 'compact' | 'full'
	const [headerQuery, setHeaderQuery] = useState('');

	useEffect(() => { setActiveTab('info'); }, [node?.id]);
	if (!node) return null;

	// Prefer the fields produced by current viz JSON (meta.*)
	const status = String(node.meta?.status ?? node.status ?? 'Unknown');
	const size = node.meta?.size ?? node.size ?? null;
	// coerce numeric-like values to numbers where possible
	const coerceNumber = (v) => {
		if (v == null) return null;
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	};
	const responseTime = coerceNumber(node.meta?.response_time_ms ?? node.meta?.responseTime ?? node.responseTime ?? null);

	// Headers in current viz are an object under meta.headers. Prefer that shape.
	const headersArray = (node.meta && node.meta.headers && typeof node.meta.headers === 'object')
		? Object.entries(node.meta.headers).map(([k, v]) => ({ key: k, value: v == null ? '' : String(v) }))
		: (Array.isArray(node.headers) ? node.headers : []);

	// Technologies are stored under meta.technologies in viz JSON
	const technologies = Array.isArray(node.meta?.technologies) ? node.meta.technologies : (Array.isArray(node.technologies) ? node.technologies : []);

	const ip = node.meta?.ip ?? node.ip ?? node.meta?.addr ?? null;
	const ports = node.meta?.ports ?? node.ports ?? [];
	const tls = node.meta?.tls_cert ?? node.meta?.tls ?? node.tls ?? null;
	const urls = node.meta?.urls ?? node.urls ?? [];
	const vulnerabilities = node.meta?.vulnerabilities ?? node.vulnerabilities ?? [];
	const title = node.meta?.title ?? node.title ?? null;
	const dirsearchCount = node.meta?.dirsearch_count ?? null;
	const wappalyzer = node.meta?.wappalyzer ?? null;

	// Render ports with optional service names
	const renderPorts = (portsList) => {
		if (!portsList || !portsList.length) return 'None';
		return portsList.map(p => {
			if (p == null) return '';
			if (typeof p === 'object') return `${p.port}${p.service ? `/${p.service}` : ''}`;
			const n = coerceNumber(p);
			return n !== null ? String(n) : String(p);
		}).filter(Boolean).join(', ');
	};

	const copyToClipboard = async (text) => {
		try { await navigator.clipboard.writeText(text); } catch (e) { /* ignore */ }
	};

	const formatSize = (b) => {
		const n = coerceNumber(b);
		if (n == null) return 'Unknown';
		if (n < 1024) return `${n} B`;
		const units = ['KB', 'MB', 'GB'];
		let val = n / 1024;
		let i = 0;
		while (val >= 1024 && i < units.length - 1) { val = val / 1024; i++; }
		return `${val.toFixed(1)} ${units[i]}`;
	};

	const filteredHeaders = headersArray.filter(h => {
		if (!headerQuery) return true;
		const q = headerQuery.toLowerCase();
		return (h.key && h.key.toLowerCase().includes(q)) || (h.value && h.value.toLowerCase().includes(q));
	});

	return (
		<aside className="details-panel" role="dialog" aria-label="Node details">
			<div className="panel-header">
				<div className="node-title">
					<strong>{node.value || node.label || node.id}</strong>
					<div className="node-sub">{node.type || node.group || ''} {node.protocol ? `• ${node.protocol}` : ''}</div>
				</div>
				<div className="panel-actions">
					<div className="view-toggle">
						<button className={viewMode === 'compact' ? 'active' : ''} onClick={() => setViewMode('compact')} title="Compact view">Compact</button>
						<button className={viewMode === 'full' ? 'active' : ''} onClick={() => setViewMode('full')} title="Full view">Full</button>
					</div>
					<button onClick={onClose} aria-label="Close">×</button>
				</div>
			</div>

			<div className="panel-tabs">
				<button className={activeTab === 'info' ? 'active' : ''} onClick={() => setActiveTab('info')}>Info</button>
				<button className={activeTab === 'headers' ? 'active' : ''} onClick={() => setActiveTab('headers')}>Headers</button>
				<button className={activeTab === 'tech' ? 'active' : ''} onClick={() => setActiveTab('tech')}>Tech</button>
				<button className={activeTab === 'vuln' ? 'active' : ''} onClick={() => setActiveTab('vuln')}>Security</button>
			</div>

			<div className="panel-body">
				{activeTab === 'info' && (
					<div className="info-grid">
						{title && <div className="info-row"><div className="label">Title</div><div className="value">{title}</div></div>}
						<div className="info-row"><div className="label">Status</div><div className="value">{status}</div></div>
						<div className="info-row"><div className="label">Size</div><div className="value">{size ? formatSize(size) : 'Unknown'}</div></div>
						<div className="info-row"><div className="label">Response Time</div><div className="value">{responseTime !== null ? `${responseTime} ms` : 'N/A'}</div></div>
						<div className="info-row"><div className="label">IP</div><div className="value">{ip || 'Unknown'}</div></div>
						<div className="info-row"><div className="label">Ports</div><div className="value">{renderPorts(ports)}</div></div>
						<div className="info-row"><div className="label">TLS</div><div className="value">{tls ? (tls.common_name ?? tls.subject ?? tls.issuer ?? JSON.stringify(tls)) : 'No TLS info'}</div></div>
						{dirsearchCount != null && <div className="info-row"><div className="label">Dirsearch</div><div className="value">{dirsearchCount}</div></div>}
						{wappalyzer && <div className="info-row"><div className="label">Wappalyzer</div><div className="value">{wappalyzer.error ? wappalyzer.error : JSON.stringify(wappalyzer)}</div></div>}
						<div className="info-row"><div className="label">URLs</div><div className="value">{(urls && urls.length) ? (<ul>{urls.map((u,i)=>(<li key={i}><a href={u} target="_blank" rel="noreferrer">{u}</a></li>))}</ul>) : 'None'}</div></div>
						{/* compact headers preview */}
						<div className="info-row"><div className="label">Headers</div><div className="value headers-list">{
							headersArray.length ? (
								viewMode === 'compact' ? (
									<div>
										<div className="header-preview">{headersArray.slice(0,3).map((h,i)=>(<div key={i} className="header-item"><strong>{h.key}</strong>: {h.value}</div>))}</div>
										{headersArray.length > 3 && <button onClick={()=>setActiveTab('headers')}>Show all headers</button>}
									</div>
								) : (
									headersArray.map((h,i)=>(<div key={i} className="header-item"><div className="header-key">{h.key}</div><div className="header-sep">:</div><div className="header-val">{h.value}</div><button className="copy-btn" onClick={()=>copyToClipboard(`${h.key}: ${h.value}`)} title="Copy header">Copy</button></div>))
								)
							) : (<div className="empty">No headers available</div>)
						}</div></div>

						<div className="info-row"><div className="label">Raw meta</div><div className="value"><button onClick={()=>setShowRaw(s=>!s)}>{showRaw ? 'Hide' : 'Show'} raw</button>{showRaw && (<pre className="raw-meta">{JSON.stringify(node.meta || {}, null, 2)}</pre>)}</div></div>
					</div>
				)}

				{activeTab === 'headers' && (
					<div className="headers-tab">
						<div className="headers-controls"><input placeholder="Search headers..." value={headerQuery} onChange={e=>setHeaderQuery(e.target.value)} /></div>
						<div className="headers-list-full">{filteredHeaders.length ? filteredHeaders.map((h,i)=>(<div key={i} className="header-item"><div className="header-key">{h.key}</div><div className="header-sep">:</div><div className="header-val">{h.value}</div><button className="copy-btn" onClick={()=>copyToClipboard(`${h.key}: ${h.value}`)} title="Copy header">Copy</button></div>)) : <div className="empty">No headers match</div>}</div>
					</div>
				)}

				{activeTab === 'tech' && (
					<div className="tech-list">{technologies.length ? technologies.map((t,i)=>(<div className="tech-item" key={i}>{t}</div>)) : <div className="empty">No technologies detected</div>}</div>
				)}

				{activeTab === 'vuln' && (
					<div className="vuln-list">{vulnerabilities.length ? vulnerabilities.map((v,i)=>(<div key={i} className="vuln-item">{v}</div>)) : <div className="empty">No issues found</div>}</div>
				)}
			</div>
		</aside>
	);
};

export default DetailsPanel;

