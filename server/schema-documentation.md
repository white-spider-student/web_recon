# Web Recon Map Database Schema

## Overview
This document describes the database schema for the Web Recon Map application, which has been enhanced to support multi-website capability with proper normalization and relationships.

## Entity Relationship Diagram

```mermaid
erDiagram
    WEBSITES ||--o{ NODES : contains
    NODES ||--o{ NODE_HEADERS : has
    NODES ||--o{ NODE_TECHNOLOGIES : has
    NODES ||--o{ NODE_VULNERABILITIES : has
    NODES }o--o{ NODES : related_via
    NODE_RELATIONSHIPS }o--|| NODES : source
    NODE_RELATIONSHIPS }o--|| NODES : target

    WEBSITES {
        INTEGER id PK
        TEXT url UNIQUE
        TEXT name
        TIMESTAMP created_at
        TIMESTAMP last_scan
    }

    NODES {
        INTEGER id PK
        INTEGER website_id FK
        TEXT node_id
        TEXT type
        TEXT group_name
        TEXT status
        TEXT response_size
        TEXT method
        TEXT file_type
        TEXT description
        TIMESTAMP created_at
        TIMESTAMP last_seen
    }

    NODE_HEADERS {
        INTEGER id PK
        INTEGER node_id FK
        TEXT header_key
        TEXT header_value
    }

    NODE_TECHNOLOGIES {
        INTEGER id PK
        INTEGER node_id FK
        TEXT technology
    }

    NODE_VULNERABILITIES {
        INTEGER id PK
        INTEGER node_id FK
        TEXT vulnerability
    }

    NODE_RELATIONSHIPS {
        INTEGER id PK
        INTEGER source_node_id FK
        INTEGER target_node_id FK
        TEXT relationship_type
    }
```

## Table Descriptions

### WEBSITES
Stores information about target websites.

**Columns:**
- `id` (INTEGER, PRIMARY KEY, AUTOINCREMENT): Unique identifier for the website
- `url` (TEXT, UNIQUE, NOT NULL): The URL of the target website
- `name` (TEXT): Optional display name for the website
- `created_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP): When the website was added
- `last_scan` (TIMESTAMP): When the website was last scanned

### NODES
Stores information about discovered nodes (endpoints, directories, subdomains, etc.).

**Columns:**
- `id` (INTEGER, PRIMARY KEY, AUTOINCREMENT): Unique identifier for the node
- `website_id` (INTEGER, NOT NULL, FK): Reference to the website this node belongs to
- `node_id` (TEXT, NOT NULL): Original identifier (e.g., /login, api.target.com)
- `type` (TEXT): Type of node (domain, subdomain, directory, endpoint, file)
- `group_name` (TEXT): Group name for compatibility with existing code
- `status` (TEXT): HTTP status code
- `response_size` (TEXT): Size of the response
- `method` (TEXT): HTTP method (GET, POST, etc.)
- `file_type` (TEXT): Type of file (Env, Text, XML, etc.)
- `description` (TEXT): Description of the node
- `created_at` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP): When the node was first seen
- `last_seen` (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP): When the node was last observed

### NODE_HEADERS
Stores HTTP headers for each node.

**Columns:**
- `id` (INTEGER, PRIMARY KEY, AUTOINCREMENT): Unique identifier
- `node_id` (INTEGER, NOT NULL, FK): Reference to the node
- `header_key` (TEXT, NOT NULL): Header name
- `header_value` (TEXT, NOT NULL): Header value

### NODE_TECHNOLOGIES
Stores detected technologies for each node.

**Columns:**
- `id` (INTEGER, PRIMARY KEY, AUTOINCREMENT): Unique identifier
- `node_id` (INTEGER, NOT NULL, FK): Reference to the node
- `technology` (TEXT, NOT NULL): Name of the detected technology

### NODE_VULNERABILITIES
Stores potential vulnerabilities for each node.

**Columns:**
- `id` (INTEGER, PRIMARY KEY, AUTOINCREMENT): Unique identifier
- `node_id` (INTEGER, NOT NULL, FK): Reference to the node
- `vulnerability` (TEXT, NOT NULL): Description of the potential vulnerability

### NODE_RELATIONSHIPS
Stores relationships between nodes for graph visualization.

**Columns:**
- `id` (INTEGER, PRIMARY KEY, AUTOINCREMENT): Unique identifier
- `source_node_id` (INTEGER, NOT NULL, FK): Reference to the source node
- `target_node_id` (INTEGER, NOT NULL, FK): Reference to the target node
- `relationship_type` (TEXT): Type of relationship

## Indexes

The following indexes have been created to optimize query performance:

1. `idx_nodes_website_id` - ON nodes(website_id)
2. `idx_node_headers_node_id` - ON node_headers(node_id)
3. `idx_node_technologies_node_id` - ON node_technologies(node_id)
4. `idx_node_vulnerabilities_node_id` - ON node_vulnerabilities(node_id)
5. `idx_node_relationships_source` - ON node_relationships(source_node_id)
6. `idx_node_relationships_target` - ON node_relationships(target_node_id)
7. `idx_nodes_website_node_id` - ON nodes(website_id, node_id)
8. `idx_nodes_type` - ON nodes(type)
9. `idx_nodes_status` - ON nodes(status)
10. `idx_nodes_last_seen` - ON nodes(last_seen)
11. `idx_websites_last_scan` - ON websites(last_scan)
12. `idx_nodes_file_type` - ON nodes(file_type)
13. `idx_nodes_website_type` - ON nodes(website_id, type)
14. `idx_nodes_website_status` - ON nodes(website_id, status)

## Foreign Key Constraints

- `nodes.website_id` REFERENCES `websites.id` ON DELETE CASCADE
- `node_headers.node_id` REFERENCES `nodes.id` ON DELETE CASCADE
- `node_technologies.node_id` REFERENCES `nodes.id` ON DELETE CASCADE
- `node_vulnerabilities.node_id` REFERENCES `nodes.id` ON DELETE CASCADE
- `node_relationships.source_node_id` REFERENCES `nodes.id` ON DELETE CASCADE
- `node_relationships.target_node_id` REFERENCES `nodes.id` ON DELETE CASCADE

## Migration Notes

The schema was migrated from a single `nodes` table to the new normalized structure. Existing data was preserved by:

1. Creating a default website entry for all existing nodes
2. Transferring node data to the new `nodes` table
3. Parsing JSON data and populating the attribute tables
4. Maintaining relationships through the new `node_relationships` table

## API Endpoints

The server now provides the following endpoints for interacting with the new schema:

- `GET /websites` - Get all websites
- `POST /websites` - Create a new website
- `GET /websites/:websiteId/nodes` - Get all nodes for a specific website
- `GET /nodes` - Get all nodes across all websites
- `POST /websites/:websiteId/nodes` - Create a new node for a specific website
- `POST /nodes/:sourceNodeId/relationships/:targetNodeId` - Create a relationship between two nodes
- `GET /nodes/:nodeId/relationships` - Get relationships for a node