# Web Recon Map

Web Recon Map is a full-stack toolkit for running web reconnaissance scans and visualizing results as an interactive graph. It combines a Python-based recon orchestrator, a Node/Express API backed by SQLite, and a React UI for exploring websites, nodes, technologies, and relationships.

## What This Repo Includes

- Recon orchestration that runs subdomain discovery, HTTP scanning, and link discovery.
- A SQLite schema and API server for storing and serving scan results.
- A React app that renders recon data as a graph and supports reporting views.

## Repository Layout

- `src/` React UI (graph + report views).
- `server/` Express API, SQLite DB, schema, and import helpers.
- `recon/` Python recon tools and import helpers.
- `results/` Scan outputs produced by the orchestrator.
- `docs/` Architecture notes and diagrams.
- `web_recon/` Legacy standalone recon scripts and wordlists.

## Quick Start (UI + API)

1) Install client dependencies and start the UI:
```bash
npm install
npm start
```

2) Start the API server (in a separate terminal):
```bash
cd server
npm install
npm start
```

The UI runs at `http://localhost:3000` and the API runs at `http://localhost:3001`.

## Run a Recon Scan

The orchestrator writes results into `server/data.db` and the `results/` folder.

```bash
# Initialize the SQLite DB (safe to run multiple times)
node server/init_and_import.js

# Run a full scan for a domain and import into SQLite
node server/init_and_import.js example.com

# Or run the Python orchestrator directly
python3 run_all.py example.com
```

## Docs

- Architecture notes: `docs/architecture.md`
- System diagram: `docs/architecture.svg`
- Project report: `docs/project_report.md`
- Interactive diagram: `docs/interactive_diagram.html`

## Notes

- The API expects a local SQLite DB at `server/data.db`.
- If you see `Missing dependency: sqlite3`, run `cd server && npm install sqlite3`.
