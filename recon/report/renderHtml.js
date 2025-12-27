function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderKeyValueRows(obj) {
  const entries = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
  return entries.map(([k, v]) => `<div class="kv-row"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join('');
}

function renderTableRows(nodes, limit) {
  const rows = nodes.slice(0, limit);
  return rows.map(n => {
    return `<tr>
      <td>${escapeHtml(n.type)}</td>
      <td>${escapeHtml(n.label)}</td>
      <td class="wrap">${escapeHtml(n.fullUrl)}</td>
      <td>${escapeHtml(n.status ?? '—')}</td>
      <td>${escapeHtml(n.firstSeen ?? '—')}</td>
      <td>${escapeHtml(n.lastSeen ?? '—')}</td>
      <td>${escapeHtml(n.seenCount ?? '—')}</td>
    </tr>`;
  }).join('');
}

function renderHtml(report) {
  const { meta, summary, nodes } = report;
  const nodeLimit = 3000;
  const hasMore = nodes.length > nodeLimit;
  const jsonData = JSON.stringify(report).replace(/</g, '\\u003c');
  const topHubsRows = summary.topHubs.map(h => `<tr><td>${escapeHtml(h.label)}</td><td>${escapeHtml(h.type)}</td><td>${escapeHtml(h.outCount)}</td></tr>`).join('');
  const interestingRows = summary.interestingEndpoints.slice(0, 200).map(n => `<tr><td>${escapeHtml(n.label)}</td><td class="wrap">${escapeHtml(n.fullUrl)}</td><td>${escapeHtml(n.status)}</td></tr>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Full Scan Report - ${escapeHtml(meta.scanId)}</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: "Segoe UI", Arial, sans-serif; margin: 24px; color: #0f172a; background: #f4f7fb; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 20px; }
    h1 { font-size: 22px; margin: 0 0 6px; }
    .meta { font-size: 12px; color: #475569; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .btn { border: 1px solid #cbd5f5; background: #fff; padding: 8px 12px; border-radius: 8px; cursor: pointer; font-size: 12px; }
    .btn:hover { background: #eef2ff; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; box-shadow: 0 6px 12px rgba(15,23,42,0.06); }
    .card h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; }
    .kv-row { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; }
    .kv-row span { color: #475569; }
    .kv-row strong { color: #0f172a; }
    .section { margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; color: #475569; font-weight: 600; position: sticky; top: 0; }
    .wrap { word-break: break-word; overflow-wrap: anywhere; }
    .note { font-size: 12px; color: #64748b; margin-top: 8px; }
    @media print { .actions { display: none; } body { background: #fff; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Full Scan Report</h1>
      <div class="meta">ScanId: ${escapeHtml(meta.scanId)} · Generated: ${escapeHtml(meta.generatedAt)}</div>
      <div class="meta">Nodes: ${escapeHtml(meta.nodeCount)} · Edges: ${escapeHtml(meta.edgeCount)} · FirstSeen: ${escapeHtml(meta.firstSeenMin ?? '—')} · LastSeen: ${escapeHtml(meta.lastSeenMax ?? '—')}</div>
    </div>
    <div class="actions">
      <button class="btn" onclick="window.print()">Print / Save as PDF</button>
      <button class="btn" onclick="downloadPdf()">Download PDF</button>
      <button class="btn" onclick="downloadReport()">Download report.json</button>
    </div>
  </header>

  <section class="grid">
    <div class="card">
      <h3>Nodes By Type</h3>
      ${renderKeyValueRows(summary.byType)}
    </div>
    <div class="card">
      <h3>Nodes By Host</h3>
      ${renderKeyValueRows(summary.byHost)}
    </div>
    <div class="card">
      <h3>Status Codes</h3>
      ${renderKeyValueRows(summary.byStatus)}
    </div>
    <div class="card">
      <h3>File Extensions</h3>
      ${renderKeyValueRows(summary.byExt)}
    </div>
    <div class="card">
      <h3>Top Hubs</h3>
      <table>
        <thead><tr><th>Node</th><th>Type</th><th>Children</th></tr></thead>
        <tbody>${topHubsRows}</tbody>
      </table>
    </div>
    <div class="card">
      <h3>Interesting Endpoints</h3>
      <table>
        <thead><tr><th>Label</th><th>URL</th><th>Status</th></tr></thead>
        <tbody>${interestingRows}</tbody>
      </table>
    </div>
  </section>

  <section class="card section">
    <h3>All Nodes</h3>
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Label</th>
          <th>Full URL</th>
          <th>Status</th>
          <th>FirstSeen</th>
          <th>LastSeen</th>
          <th>SeenCount</th>
        </tr>
      </thead>
      <tbody>
        ${renderTableRows(nodes, nodeLimit)}
      </tbody>
    </table>
    ${hasMore ? `<div class="note">Showing first ${nodeLimit} nodes; use Download report.json for full list.</div>` : ''}
  </section>

  <script>
    const REPORT_DATA = ${jsonData};
    function downloadReport() {
      const blob = new Blob([JSON.stringify(REPORT_DATA, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'full_report_${escapeHtml(meta.scanId)}.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    }
    function downloadPdf() {
      const scanId = encodeURIComponent('${escapeHtml(meta.scanId)}');
      window.open('/api/report/full.pdf?scanId=' + scanId, '_blank');
    }
  </script>
</body>
</html>`;
}

module.exports = { renderHtml };
