# Web Recon – System Diagram

This diagram illustrates the end-to-end architecture and data flow of the Web Recon cybersecurity tool.

```mermaid
flowchart LR
    %% Styles
    classDef ui fill:#3b82f6,stroke:#1e40af,color:#fff,stroke-width:1px
    classDef backend fill:#22c55e,stroke:#166534,color:#072,stroke-width:1px
    classDef engine fill:#f59e0b,stroke:#92400e,color:#231,stroke-width:1px
    classDef db fill:#a855f7,stroke:#6b21a8,color:#fff,stroke-width:1px
    classDef viz fill:#ef4444,stroke:#7f1d1d,color:#fff,stroke-width:1px
    classDef out fill:#64748b,stroke:#334155,color:#fff,stroke-width:1px

    %% Nodes
    UI["User Frontend\n(HTML/JS UI)\n• Enter target domain\n• Controls & filters"]:::ui

    API["Backend\n(Node.js/Express)\n• Validate input\n• Start scans\n• Serve results\n• Export endpoints"]:::backend

    subgraph Engines[Recon Modules]
        direction TB
        SUBS["Subdomain Enumeration\n(ffuf, dirsearch, DNS)"]:::engine
        PORTS["Port Scan API\n(nmap wrappers)"]:::engine
        TECH["Technology Detection\n(whatweb, webanalyze, banners)"]:::engine
        WHOIS["WHOIS\n(domain records)"]:::engine
        HEADERS["HTTP Headers\n(status, content length, HSTS)"]:::engine
        VULN["Vulnerability Checks\n(basic heuristics / signatures)"]:::engine
    end

    DB["Database / Storage\n(SQLite or JSON)\n• websites\n• nodes (domain/subdomain/directory/endpoint)\n• relationships (contains)\n• headers/tech/vulns"]:::db

    VIZ["Results Visualization\nInteractive Dashboard\nTables / Graphs / Recon Map"]:::viz

    OUT["Output Export\nPDF / JSON"]:::out

    %% Data Flow
    UI -->|Enter domain| API
    API -->|Orchestrate scans| SUBS
    API --> PORTS
    API --> TECH
    API --> WHOIS
    API --> HEADERS
    API --> VULN

    SUBS -->|Discover hosts| DB
    PORTS -->|Service/port info| DB
    TECH -->|Detected tech| DB
    WHOIS -->|Domain data| DB
    HEADERS -->|HTTP metadata| DB
    VULN -->|Findings| DB

    DB -->|Serve aggregated results| API
    API -->|REST/JSON| UI

    UI -->|Visualize| VIZ
    VIZ -->|Export| OUT

    %% Notes
    note over API,DB: Importers normalize URLs into hierarchy\n(domain → subdomain → directories → endpoints)\nwith de-duplication and parent-child relationships.
```

## Legend & Notes
- User Frontend: HTML/JS UI where the user enters a domain, sets options, and views results.
- Backend: Node.js/Express API validates inputs, triggers scans, reads/writes to the database, and serves JSON to the UI.
- Recon Modules: Independent engines/tools orchestrated by the backend or a Python runner. Results are normalized and stored.
- Database/Storage: SQLite (primary) or JSON files for portability. Contains hierarchical nodes and edges with metadata.
- Visualization: Interactive graph (mind map), tabular summaries, and charts. Supports filters, levels, and toggles.
- Output: Exports selected data views to JSON and PDF for reports.

## Data Normalization
- URLs are parsed into hierarchical nodes:
  - domain → subdomain → directory levels → endpoint/file
- Each node is unique per website and path; edges (contains) represent parent-child relationships.
- Headers, technologies, vulnerabilities attach as metadata to nodes.

## Export Paths
- JSON: API returns structured data for the UI or external tools.
- PDF: Frontend prints/export views for reporting.
