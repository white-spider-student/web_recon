const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5500'
];

function parseNumber(value, fallback) {
  const n = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseCorsOrigins(raw) {
  if (!raw) return { allowAll: false, origins: DEFAULT_CORS_ORIGINS };
  const trimmed = String(raw).trim();
  if (trimmed === '*') return { allowAll: true, origins: [] };
  const origins = trimmed
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
  return { allowAll: false, origins: origins.length ? origins : DEFAULT_CORS_ORIGINS };
}

const corsConfig = parseCorsOrigins(process.env.CORS_ORIGINS);

module.exports = {
  port: parseNumber(process.env.PORT, 3001),
  bodyLimit: process.env.BODY_LIMIT || '1mb',
  cors: corsConfig,
  rateLimit: {
    windowMs: parseNumber(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    max: parseNumber(process.env.RATE_LIMIT_MAX, 300)
  },
  scanRateLimit: {
    windowMs: parseNumber(process.env.SCAN_RATE_LIMIT_WINDOW_MS, 60_000),
    max: parseNumber(process.env.SCAN_RATE_LIMIT_MAX, 10)
  },
  reportRateLimit: {
    windowMs: parseNumber(process.env.REPORT_RATE_LIMIT_WINDOW_MS, 60_000),
    max: parseNumber(process.env.REPORT_RATE_LIMIT_MAX, 30)
  },
  pdf: {
    allowNoSandbox: String(process.env.PDF_ALLOW_NO_SANDBOX || '').toLowerCase() === 'true'
  }
};
