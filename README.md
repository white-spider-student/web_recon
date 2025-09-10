# Web Reconnaissance Tool

A comprehensive web reconnaissance tool for discovering and visualizing domain information, subdomains, directories, and potential vulnerabilities.

## Project Overview

This project provides a set of tools for conducting web reconnaissance on target domains:

1. **Subdomain Discovery**: Find subdomains of target websites
2. **Directory Scanning**: Discover directories and files on websites
3. **Technology Detection**: Identify technologies used by websites
4. **Visualization**: Display reconnaissance data in an interactive graph
5. **Data Storage**: Store and query reconnaissance results in a SQLite database

## Project Structure

```
.
├── build/                  # React application build for the visualization interface
├── public/                 # Static assets for the React application
├── recon/                  # Python reconnaissance modules
│   ├── ffuf_subs.py        # Subdomain discovery using ffuf
│   ├── ffuf.py             # Directory scanning using ffuf
│   ├── nmap_http.py        # HTTP service detection using nmap
│   ├── webanalyze.py       # Technology detection using webanalyze
│   └── whatweb.py          # Technology detection using whatweb
├── server/                 # Node.js server for the visualization interface
│   ├── data.db             # SQLite database for storing reconnaissance data
│   ├── import-visualized-data.js   # Script to import visualization data
│   ├── index.js            # Main server file
│   ├── init-db.js          # Database initialization script
│   └── schema.sql          # Database schema
├── src/                    # React application source code
│   ├── components/         # React components
│   │   ├── DetailsPanel.jsx # Panel for displaying details about selected nodes
│   │   ├── Graph.jsx       # Graph visualization component
│   │   └── HierarchicalGraph.jsx # Hierarchical graph visualization
│   └── types/              # TypeScript type definitions
│       └── NodeTypes.js    # Node type definitions for the graph
└── results/                # Directory for storing scan results
```

## Features

- **Subdomain Discovery**: Identify subdomains using various techniques
- **Directory Scanning**: Find directories, files, and endpoints
- **Technology Detection**: Identify web technologies, frameworks, and servers
- **Vulnerability Identification**: Flag potential security issues
- **Relationship Mapping**: Visualize relationships between domains, subdomains, directories
- **Interactive Visualization**: Explore reconnaissance data using an interactive graph
- **Data Export/Import**: Save and load reconnaissance data

## Getting Started

### Prerequisites

- Node.js and npm
- Python 3.x
- SQLite3
- Various reconnaissance tools (ffuf, nmap, etc.)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/white-spider-student/web_recon.git
   cd web_recon
   ```

2. Install server dependencies:
   ```bash
   cd server
   npm install
   ```

3. Install frontend dependencies:
   ```bash
   cd ..
   npm install
   ```

4. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

### Usage

#### Running a Scan

1. Start a scan with the web scanner tool:
   ```bash
   python web_scanner.py -d example.com
   ```
   
2. Extract and format the results:
   ```bash
   python dir_extract.py
   ```
   
3. Import data into the database:
   ```bash
   cd server
   node import-visualized-data.js ../results/recon_sql_*.json
   ```

#### Starting the Visualization Server

1. Start the Node.js server:
   ```bash
   cd server
   npm start
   ```
   
2. Start the React development server:
   ```bash
   npm start
   ```
   
3. Open your browser and navigate to `http://localhost:3000`

## Visualization

The visualization interface displays:

- **Domains**: Main target domains
- **Subdomains**: Discovered subdomains
- **Directories**: Discovered directories and files
- **Relationships**: Connections between different entities
- **Details**: Information about selected nodes including status codes, content types, etc.

## Database Schema

The application uses a SQLite database with the following main tables:

- **websites**: Information about target websites
- **nodes**: Discovered entities (domains, subdomains, directories, etc.)
- **node_relationships**: Connections between nodes
- **node_vulnerabilities**: Detected vulnerabilities
- **node_technologies**: Detected technologies
- **node_headers**: HTTP headers

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- This tool uses various open-source reconnaissance tools
- Visualization is built using React and D3.js
