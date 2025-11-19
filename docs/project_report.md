 # Web Recon Map — Project Report

Generated: 2025-11-04

This report summarizes the Web Recon Map project: goals, architecture, key components, recent fixes and improvements, verification steps, and recommended next actions. It is written to be suitable for inclusion in documentation, a PR description, or as a deliverable to a stakeholder.

## 1. Project purpose

Web Recon Map is an automated reconnaissance toolchain and visualization platform. It runs web scanning tools, cleans and normalizes results into a "viz" JSON format, imports those visualizations into an SQLite-backed normalized schema, and exposes an API plus a React-based UI to explore findings.

Primary aims:
- Discover subdomains, directories, and endpoints
- Capture HTTP response metadata (headers, response time, size)
- Detect technologies (wappalyzer) and TLS certificate metadata
- Visualize relationships between hostname, subdomain, and discovered endpoints

## 2. High-level architecture

Components:
- recon/ — scanning scripts and wrappers (ffuf, dirsearch, nmap, fingerprinting)
- cleaning & formatting — `clean_from_raw.py`, `minmap_format.py` produce `results/clean/<host>_viz.json`
- server/ — Express API, importer scripts, DB schema, utility scripts
- src/ — React frontend (graph visualization, `DetailsPanel`)
- results/clean — canonical viz JSON files

Data flow:
1. Scanners produce raw outputs in `results/`.
2. `clean_from_raw.py` normalizes scanner output into cleaned JSON files.
3. `minmap_format.py` assembles a compact viz JSON containing nodes, relationships, and `meta` objects.
4. `server/import-visualized-data.js` imports viz JSON into `server/data.db` (nodes, headers, technologies, relationships).
5. Express API (`server/index.js`) serves data to the frontend and provides helper endpoints like `/websites/:id/viz` for raw viz JSON.
6. React UI consumes API or raw viz JSON to render graphs and show per-node details.

## 3. Notable files and locations

- `recon/` — scanner helpers: `ffuf_subs.py`, `dirsearch/`, `nmap_http.py`, `simple_fingerprint.py`
- `clean_from_raw.py` — normalizes raw scanner output
- `minmap_format.py` — creates the visualization JSON
- `results/clean/<host>_viz.json` — canonical viz JSON with `meta` including `ip`, `headers`, `ports` etc.
- `server/index.js` — Express server, DB initialization, API endpoints, import helpers
- `server/import-visualized-data.js` — importer (merge/replace logic)
- `server/dedupe-nodes.js` — dedupe utility to consolidate existing duplicates
- `server/schema.sql` & `server/schema-documentation.md` — DB schema and documentation
- `src/components/DetailsPanel.jsx` — UI rendering for per-node metadata

## 4. Recent fixes & changes (summary)

These changes were implemented to improve robustness and ensure the frontend can display full scan metadata.

- DetailsPanel: made defensive and prioritized `node.meta.*` fields (status, ip, response_time_ms, headers, title, ports, technologies).
- Server API: added schema-flexible logic, ensured optional meta columns exist, and merged legacy `details` JSON into `node.meta` when present.
- Importer: implemented "delete-then-insert" behavior for matched nodes (`website_id + value`) so imports replace previous scan data rather than partially updating or leaving duplicates.
- Dedupe tool: `server/dedupe-nodes.js` created to consolidate historical duplicates by choosing a canonical node and reassigning child rows and relationships.
- New endpoint: `GET /websites/:websiteId/viz` serves the raw viz JSON file in `results/clean/` so the frontend can fetch the exact file created by the cleaning pipeline.

## 5. Verification performed

Actions taken and observed results (representative):

- Ran `node server/import-visualized-data.js results/clean/example.com_viz.json` — importer completed successfully.
- Verified `nodes` table contains meta columns (`ip`, `response_time_ms`, `title`, `ports`, `tls_cert`, `dirsearch_count`, `wappalyzer`).
- Confirmed `node_headers` contains headers attached to canonical node IDs.
- Restarted server and validated `GET /websites/27/viz` returns the raw example viz JSON and includes `meta.ip` for both `example.com` and `www.example.com`.
- Ran `node server/dedupe-nodes.js` to collapse duplicates and verified API (`GET /websites/27/nodes`) returns a single enriched node per host.

## 6. How to reproduce (quick steps)

1. Ensure dependencies installed:

```bash
npm install
```

2. Start the server (defaults to port 3001):

```bash
node server/index.js
```

3. Import a viz file:

```bash
node server/import-visualized-data.js results/clean/example.com_viz.json
```

4. Optionally dedupe prior duplicates:

```bash
node server/dedupe-nodes.js
```

5. Request raw viz JSON in the frontend or with curl:

```bash
curl http://localhost:3001/websites/27/viz
```

6. Request API nodes (assembled from DB):

```bash
curl http://localhost:3001/websites/27/nodes
```

## 7. Known limitations & recommendations

- Add a UNIQUE index on `(website_id, value)` to prevent future duplicate node insertion. Before adding the index, run `dedupe-nodes.js` to remove existing duplicates.
- Consider switching importer from delete-then-insert to `INSERT OR REPLACE`/UPDATE semantics if preserving node IDs is important for external references.
- Add small unit tests for the importer and dedupe tool to ensure repeatable behavior.
- Add API integration tests that verify `meta` fields (including `ip`) are present after import.
- Document required optional tools for full metadata (wappalyzer, TLS parsers) and expose clear fallbacks in the UI when they are missing.

## 8. Suggested next work items

1. Add a migration that runs dedupe then creates a unique index on `(website_id, value)`.
2. Add a `viz-files` static route: `app.use('/viz-files', express.static(path.join(__dirname, '..', 'results', 'clean')))` for direct frontend access.
3. Add a small React component to allow uploading a local viz JSON and previewing it in the UI.
4. Prepare a release / CHANGELOG entry summarizing these fixes and the API addition.

## 9. Commit message (suggested)

```
Add project README and reporting; fix server import and viz endpoint

- Add top-level README.md with setup and usage
- Add server endpoint /websites/:id/viz to serve raw viz JSON
- Fix server fs import bug
- Implement delete-then-insert importer behavior and dedupe utility
```

---

If you want, I can:
- Convert this report to PDF and attach it to the repo
- Open a new branch, commit `docs/project_report.md` and `README.md`, and push + create a PR with the suggested description above
- Expand the report with screenshots or an architecture diagram exported from `docs/architecture.svg` (requires you to provide or approve an image)

Which of those follow-ups would you like me to do now?
