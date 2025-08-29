# Web Recon Map

Web Recon Map is a full-stack web application for visualizing the structure and relationships of nodes (such as subdomains, directories, endpoints, technologies, and vulnerabilities) discovered during web reconnaissance. It features a React-based interactive graph UI and a Node.js/Express backend with a normalized SQLite database schema.

## Features

- **Interactive Graph Visualization:** Explore discovered nodes and their relationships using a force-directed graph.
- **Multi-Website Support:** Manage and visualize data for multiple target websites.
- **Node Details Panel:** View HTTP status, headers, technologies, and vulnerability hints for each node.
- **Filtering & Search:** Filter nodes by status, technology, type, method, and file type. Search nodes and highlight paths.
- **API Server:** RESTful API for managing websites, nodes, and relationships.
- **Database Schema:** Normalized SQLite schema with tables for websites, nodes, headers, technologies, vulnerabilities, and relationships.

## Project Structure

```
.
├── public/                # Static assets and HTML template
├── src/                   # React frontend source code
│   ├── components/        # React components (Graph, DetailsPanel)
│   └── App.js             # Main application
├── server/                # Node.js/Express backend and database scripts
│   ├── index.js           # API server
│   ├── migrate.js         # Database migration script
│   ├── seed-data.js       # Sample data seeding script
│   ├── test-schema.js     # Schema validation script
│   └── view-data.js       # Data viewing utility
├── package.json           # Frontend dependencies and scripts
└── README.md             # Project documentation
```

## Getting Started

### Prerequisites

- Node.js (v16+ recommended)
- npm

### Setup

#### 1. Install Frontend Dependencies

```sh
npm install
```

#### 2. Install Backend Dependencies

```sh
cd server
npm install
```

#### 3. Initialize the Database

You can seed the database with sample data:

```sh
node seed-data.js
```

Or migrate an existing database to the new schema:

```sh
node migrate.js
```

#### 4. Start the Backend Server

```sh
node index.js
```

The API server will run at [http://localhost:3001](http://localhost:3001).

#### 5. Start the Frontend

In the project root:

```sh
npm start
```

The React app will run at [http://localhost:3000](http://localhost:3000).

## API Endpoints

- `GET /websites` — List all websites
- `POST /websites` — Create a new website
- `GET /websites/:websiteId/nodes` — Get nodes and relationships for a website
- `POST /websites/:websiteId/nodes` — Add a node to a website
- `POST /nodes/:sourceNodeId/relationships/:targetNodeId` — Create a relationship
- `GET /nodes/:nodeId/relationships` — Get relationships for a node

See `server/schema-documentation.md` for full schema details.

## Available Scripts

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

### `npm test`

Launches the test runner in the interactive watch mode.

### `npm run build`

Builds the app for production to the `build` folder.

## License

MIT

---

*Made with React, D3, and Express. For educational and research purposes.*
