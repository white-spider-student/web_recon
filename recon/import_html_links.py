#!/usr/bin/env python3
"""
import_html_links.py <website_url> <json_path>

Reads results/html_links_<domain>.json and inserts discovered endpoints/directories
into the SQLite database (server/data.db), creating nodes and 'contains' relationships
under the correct parent (root domain or subdomain) by hostname.
"""
import sys
import json
import os
import re
from pathlib import Path
import sqlite3
from urllib.parse import urlparse, urlunparse

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SERVER_DIR = PROJECT_ROOT / 'server'
DB_PATH = SERVER_DIR / 'data.db'

def apex_of(host: str) -> str:
    host = host.lower()
    parts = host.split('.')
    if len(parts) >= 2:
        return '.'.join(parts[-2:])
    return host

def get_host(url_or_host: str) -> str:
    s = (url_or_host or '').strip()
    try:
        p = urlparse(s)
        if p.scheme and p.hostname:
            return p.hostname.lower()
    except Exception:
        pass
    # strip scheme and path
    s = re.sub(r'^https?://', '', s, flags=re.I)
    s = s.split('/')[0]
    return s.lower()

def normalize_url(u: str) -> str:
    """Normalize a URL: lowercase host, strip fragments, collapse //, remove trailing slash except root."""
    try:
        p = urlparse(u.strip())
        scheme = p.scheme or 'http'
        host = (p.hostname or '').lower()
        path = p.path or '/'
        # collapse multiple slashes
        path = re.sub(r'/+', '/', path)
        # remove fragment/query for node identity (we visualize path hierarchy)
        path = path if path.startswith('/') else '/' + path
        # remove trailing slash for files; keep for pure directories at intermediate steps
        # we keep raw path here; directory detection happens later
        return urlunparse((scheme, host, path, '', '', ''))
    except Exception:
        return u.strip()

def split_path_segments(path: str):
    """Return list of non-empty segments from a URL path."""
    path = (path or '/')
    path = re.sub(r'/+', '/', path)
    segs = [s for s in path.split('/') if s]
    return segs

def is_file_segment(segment: str) -> bool:
    """Heuristic: if last segment has an extension typical of files/endpoints."""
    if not segment:
        return False
    if '.' not in segment:
        return False
    ext = segment.split('.')[-1].lower()
    return ext in (
        'html','htm','php','asp','aspx','jsp','js','css','png','jpg','jpeg','gif','svg','ico',
        'pdf','xml','json','txt','csv','zip','gz','tar','rar','7z','mp4','woff','woff2','ttf','eot'
    )

def ensure_website(db, website_url: str) -> int:
    cur = db.cursor()
    cur.execute('SELECT id FROM websites WHERE url = ? LIMIT 1', (website_url,))
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute('INSERT INTO websites (url, name) VALUES (?, ?)', (website_url, website_url))
    return cur.lastrowid

def get_nodes_map(db, website_id: int):
    cur = db.cursor()
    cur.execute('SELECT id, value, type FROM nodes WHERE website_id = ?', (website_id,))
    id_by_value = {}
    type_by_value = {}
    for nid, value, ntype in cur.fetchall():
        id_by_value[str(value)] = nid
        type_by_value[str(value)] = ntype
    return id_by_value, type_by_value

def get_parent_node_id(db, website_id: int, host: str):
    # prefer subdomain node, else root domain node
    cur = db.cursor()
    cur.execute('SELECT id FROM nodes WHERE website_id = ? AND value = ? LIMIT 1', (host,))
    row = cur.fetchone()
    if row:
        return row[0]
    # try root apex
    apex = apex_of(host)
    cur.execute('SELECT id FROM nodes WHERE website_id = ? AND value = ? LIMIT 1', (apex,))
    row = cur.fetchone()
    return row[0] if row else None

def insert_node(db, website_id: int, value: str, ntype: str, status=None, size=None) -> int:
    cur = db.cursor()
    cur.execute('SELECT id FROM nodes WHERE website_id = ? AND value = ? LIMIT 1', (website_id, value))
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute('INSERT INTO nodes (website_id, value, type, status, size) VALUES (?, ?, ?, ?, ?)', (website_id, value, ntype, status, size))
    return cur.lastrowid

def insert_rel(db, src_id: int, tgt_id: int, rtype: str = 'contains'):
    cur = db.cursor()
    try:
        cur.execute('INSERT OR IGNORE INTO node_relationships (source_node_id, target_node_id, relationship_type) VALUES (?, ?, ?)', (src_id, tgt_id, rtype))
    except Exception:
        pass

def main():
    if len(sys.argv) < 3:
        print('Usage: python3 import_html_links.py <website_url> <json_path>')
        sys.exit(1)
    website_url = sys.argv[1].strip()
    json_path = Path(sys.argv[2])
    if not json_path.exists():
        print(f'ERROR: JSON file not found: {json_path}')
        sys.exit(2)

    data = json.loads(json_path.read_text())
    discovered = data.get('discovered', {})
    urls = discovered.get('urls', []) or []
    dirs_by_host = discovered.get('directories_by_host', {}) or {}

    db = sqlite3.connect(str(DB_PATH))
    try:
        website_id = ensure_website(db, website_url)
        id_by_value, type_by_value = get_nodes_map(db, website_id)

        # Build hierarchical directory tree and endpoints/files under hosts
        # 1) From directories_by_host (already path-like)
        for host, dir_list in dirs_by_host.items():
            parent_id = get_parent_node_id(db, website_id, host)
            if not parent_id:
                ntype = 'subdomain' if host != apex_of(host) else 'domain'
                parent_id = insert_node(db, website_id, host, ntype)
            for d in dir_list:
                # Ensure consistent path
                d = re.sub(r'/+', '/', d)
                segs = split_path_segments(d)
                cumulative = ''
                prev_id = parent_id
                for i, seg in enumerate(segs):
                    cumulative = cumulative + '/' + seg if cumulative else '/' + seg
                    node_value = f"{host}{cumulative}"
                    node_id = insert_node(db, website_id, node_value, 'directory')
                    insert_rel(db, prev_id, node_id, 'contains')
                    prev_id = node_id

        # 2) From raw URLs (create directories per segment and final leaf)
        for raw in urls:
            nu = normalize_url(raw)
            p = urlparse(nu)
            host = (p.hostname or '').lower()
            if not host:
                continue
            parent_id = get_parent_node_id(db, website_id, host)
            if not parent_id:
                ntype = 'subdomain' if host != apex_of(host) else 'domain'
                parent_id = insert_node(db, website_id, host, ntype)

            segs = split_path_segments(p.path or '/')
            cumulative = ''
            prev_id = parent_id
            for i, seg in enumerate(segs):
                cumulative = cumulative + '/' + seg if cumulative else '/' + seg
                node_value = f"{host}{cumulative}"
                is_last = (i == len(segs) - 1)
                if is_last and is_file_segment(seg):
                    ntype = 'endpoint'
                else:
                    ntype = 'directory'
                node_id = insert_node(db, website_id, node_value, ntype)
                insert_rel(db, prev_id, node_id, 'contains')
                prev_id = node_id

        db.commit()
        print(f'Imported hierarchical paths from {len(urls)} URLs and {sum(len(v) for v in dirs_by_host.values())} directory hints into DB for {website_url}')
    finally:
        db.close()

if __name__ == '__main__':
    main()