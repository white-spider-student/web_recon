const net = require('net');

function normalizeTarget(raw) {
  if (!raw) return '';
  let value = String(raw).trim();
  if (!value) return '';

  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
    value = `http://${value}`;
  }
  try {
    const parsed = new URL(value);
    const host = parsed.hostname;
    if (!host) return '';
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${host}${port}`.toLowerCase();
  } catch (e) {
    return '';
  }
}

function isValidTarget(raw) {
  const normalized = normalizeTarget(raw);
  if (!normalized) return false;
  if (normalized.length > 255) return false;
  if (normalized.includes('/')) return false;
  if (normalized.includes('@')) return false;
  if (normalized.startsWith('.') || normalized.endsWith('.')) return false;
  const host = normalized.split(':')[0];
  if (net.isIP(host)) return true;
  if (!/^[a-z0-9.-]+$/.test(host)) return false;
  if (host.split('.').some(part => !part.length)) return false;
  return true;
}

module.exports = { normalizeTarget, isValidTarget };
