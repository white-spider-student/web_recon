# Web Recon Map

A small toolkit and visualization app for web reconnaissance results. The repo contains
recon scripts (Python), data cleaning/formatting utilities, a Node/Express server that
stores results in SQLite, and a React-based frontend for interactive graph visualizations.

This README explains how the pieces fit together, how to run the server and frontend locally,
how to import visualization JSON files, and some troubleshooting tips.

---

## Repository layout (top-level)

- `recon/` : Python scripts for running scans (ffuf, nmap, dirsearch, etc.)
- `results/clean/` : cleaned output and per-site viz JSON files (e.g. `example.com_viz.json`)
- `server/` : Node/Express server, SQLite DB and import utilities
- `src/` : React frontend (create-react-app) and components (graph, Details panel)
- `web_recon/` : higher-level orchestration and legacy recon scripts
- `scripts/` : helper scripts for merging and processing results

Files of special interest:
- `server/import-visualized-data.js` - importer script that writes a viz JSON into the database
- `server/dedupe-nodes.js` - utility to deduplicate nodes by `(website_id, value)`
- `results/clean/<site>_viz.json` - canonical JSON file produced by the cleaning pipeline; contains `meta.*` fields (ip, headers, ports, etc.)
- `src/components/DetailsPanel.jsx` - UI component that shows node metadata (reads `node.meta.*`)

---

## Quick start - developer machine

Prerequisites:
- Node.js >= 16
- npm
- Python 3.8+ (for recon scripts, optional)

1. Install frontend dependencies

```bash
npm install
```

2. Start the backend server (serves APIs and the visualization endpoint)

```bash
# from repository root
node server/index.js
# Server listens on http://localhost:3001 by default
```

3. Start the frontend (CRA)

```bash
npm start
# opens http://localhost:3000
```

The frontend communicates with the server (default server URL: `http://localhost:3001`).

---

## Importing visualization JSON files (the recommended flow)

The cleaning/formatting pipeline writes per-site files to `results/clean/<site>_viz.json`.
These files are the canonical form for a site's scan data and already include `meta.ip`,
`meta.headers`, `meta.ports`, `meta.response_time_ms`, `meta.title`, and other useful fields.

To import a viz JSON into the server's SQLite DB (so the API can serve it), run:

```bash
node server/import-visualized-data.js results/clean/example.com_viz.json
```

Behavior notes:
- The importer attempts to detect existing nodes and will replace existing data for the same `(website_id, value)`.
- If legacy duplicates exist, use `server/dedupe-nodes.js` to consolidate duplicates:

```bash
node server/dedupe-nodes.js
```

After import the server exposes two useful paths:
- `GET /websites/:websiteId/nodes` — API built from DB (nodes, headers, technologies)
- `GET /websites/:websiteId/viz` — returns the raw `results/clean/<site>_viz.json` file

If you prefer the raw JSON (it always includes `meta.ip`), fetch the `/viz` endpoint from the frontend.

---

## Server endpoints (summary)

- `GET /websites` - list websites
- `POST /websites` - create website record
- `GET /websites/:websiteId/nodes` - get nodes for a website (DB-backed)
- `GET /websites/:websiteId/viz` - returns the raw viz JSON file (from `results/clean`)
- `POST /websites/:websiteId/nodes` - create a node via API
- `POST /nodes/:sourceNodeId/relationships/:targetNodeId` - create relationship
- `GET /nodes/:nodeId/relationships` - get relationships for a node

See `server/index.js` for the full implementation and additional helper routes.

---

## Frontend notes

- The React app expects nodes to have a `meta` object with common fields. `DetailsPanel.jsx` is defensive and supports both `node.meta.*` shapes and older shapes.
- To use the raw viz JSON directly in the frontend, call `/websites/:id/viz` and feed `viz.nodes` into the visualization component.

---

## Development & debugging tips

- To inspect the DB directly:

```bash
sqlite3 server/data.db
# then use PRAGMA table_info('nodes'); and SELECT queries
```

- If the server fails to start because port `3001` is in use, free it or run the server behind a proxy.
- When importing, watch the server logs for errors about missing columns — `server/index.js` contains logic to add optional meta columns when missing.

---

## Contributing

Contributions welcome. Please open issues or PRs. Suggested workflow:

1. Fork the repo
2. Create a topic branch
3. Run tests (if you add them) and verify the server and importer locally
4. Submit a PR with a clear description and tests where appropriate

Commit message convention used in this repo follows conventional commits where possible (e.g., `feat:`, `fix:`, `docs:`).

---

## License

This project is provided under the MIT License — see the `LICENSE` file if present.

---

If you'd like, I can also:
- add a short `server/README.md` with server-specific commands,
- create a `CONTRIBUTING.md` with detailed contributor guidelines,
- add a GitHub Actions workflow to run tests when PRs are opened.
