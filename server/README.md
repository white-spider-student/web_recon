# Import Visualized Data Script

This script imports visualization data from JSON files into the SQLite database for the web reconnaissance tool.

## Overview

The `import-visualized-data.js` script is designed to:

1. Load JSON data containing website reconnaissance information
2. Insert website, node, and relationship data into the SQLite database
3. Process additional node metadata (headers, technologies, vulnerabilities)
4. Structure data properly for visualization in the web interface

## Usage

```bash
node import-visualized-data.js [path/to/json/file]
```

If no file path is provided, the script will look for the most recent visualization data file in the results directory.

## Data Format

The script expects JSON data in the following format:

```json
{
  "website": {
    "url": "example.com",
    "name": "Example Website"
  },
  "nodes": [
    {
      "value": "example.com",
      "type": "domain",
      "status": 200,
      "size": 1024,
      "headers": [
        { "key": "Content-Type", "value": "text/html" }
      ],
      "technologies": ["Apache", "PHP"],
      "vulnerabilities": ["Exposed .git directory"]
    },
    // more nodes...
  ],
  "relationships": [
    {
      "source": "example.com",
      "target": "api.example.com",
      "type": "contains"
    },
    // more relationships...
  ]
}
```

## Database Structure

The script interacts with the following tables:

1. `websites` - Stores website information
2. `nodes` - Stores discovered entities (domains, directories, files)
3. `node_headers` - Stores HTTP headers for nodes
4. `node_technologies` - Stores technologies detected for nodes
5. `node_vulnerabilities` - Stores vulnerabilities detected for nodes
6. `node_relationships` - Stores relationships between nodes

## Functions

- `clearTables()` - Clears all existing data from tables
- `insertWebsite(url, name)` - Inserts a website record
- `insertNode(websiteId, nodeData)` - Inserts a node record
- `insertHeaders(nodeId, headers)` - Inserts headers for a node
- `insertTechnologies(nodeId, technologies)` - Inserts technologies for a node
- `insertVulnerabilities(nodeId, vulnerabilities)` - Inserts vulnerabilities for a node
- `insertRelationship(sourceId, targetId, type)` - Inserts a relationship between nodes
- `insertReconData(filePath)` - Main function to process and insert data

## Error Handling

The script includes error handling to:

- Validate input data format
- Report database insertion errors
- Gracefully handle missing relationships
- Ensure database connection is properly closed

## Notes

- This script preserves relationships between entities in the database
- It handles clearing existing data before importing new data
- All database operations are performed within transactions for data integrity
