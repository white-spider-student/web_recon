#!/usr/bin/env python3
"""
import_dirsearch.py <website_url> <host> <json_path>

Imports dirsearch JSON output into the SQLite database (server/data.db),
creating nodes for each discovered path (endpoint/file/directory) and
linking them under the correct host node via a 'contains' relationship.

The website_url should be the root domain used by the frontend (e.g., scanme.nmap.org),
and host is the specific subdomain or root host that dirsearch scanned (e.g., www.example.com).
"""
import sys
import json
import re
from pathlib import Path
import sqlite3
from urllib.parse import urlparse

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SERVER_DIR = PROJECT_ROOT / 'server'
DB_PATH = SERVER_DIR / 'data.db'


def apex_of(host: str) -> str:
    host = (host or '').lower()
    parts = host.split('.')
    if len(parts) >= 2:
        return '.'.join(parts[-2:])
    return host


def get_host_from_url_or_host(val: str) -> str:
    s = (val or '').strip()
    try:
        p = urlparse(s)
        if p.hostname:
            return p.hostname.lower()
    except Exception:
        pass
    s = re.sub(r'^https?://', '', s, flags=re.I)
    return (s.split('/')[0]).lower()


def ensure_website(db, website_url: str) -> int:
    cur = db.cursor()
    cur.execute('SELECT id FROM websites WHERE url = ? LIMIT 1', (website_url,))
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute('INSERT INTO websites (url, name) VALUES (?, ?)', (website_url, website_url))
    return cur.lastrowid


def get_node_id_by_value(db, website_id: int, value: str):
    cur = db.cursor()
    cur.execute('SELECT id FROM nodes WHERE website_id = ? AND value = ? LIMIT 1', (website_id, value))
    row = cur.fetchone()
    return row[0] if row else None


def insert_node(db, website_id: int, value: str, ntype: str, status=None, size=None) -> int:
    node_id = get_node_id_by_value(db, website_id, value)
    if node_id:
        # optionally update status/size if provided
        try:
            db.execute('UPDATE nodes SET type = COALESCE(type, ?), status = COALESCE(?, status), size = COALESCE(?, size) WHERE id = ?', (ntype, status, size, node_id))
        except Exception:
            pass
        return node_id
    cur = db.cursor()
    cur.execute('INSERT INTO nodes (website_id, value, type, status, size) VALUES (?, ?, ?, ?, ?)', (website_id, value, ntype, status, size))
    return cur.lastrowid


def insert_rel(db, src_id: int, tgt_id: int, rtype: str = 'contains'):
    try:
        db.execute('INSERT OR IGNORE INTO node_relationships (source_node_id, target_node_id, relationship_type) VALUES (?, ?, ?)', (src_id, tgt_id, rtype))
    except Exception:
        pass


def classify_type_from_segment(segment: str, is_last: bool) -> str:
    if not is_last:
        return 'directory'
    if '.' in (segment or ''):
        ext = segment.split('.')[-1].lower()
        if ext in ('png','jpg','jpeg','gif','svg','js','css','zip','pdf','mp4','xml','json','txt','bak','conf','sql','ini','yaml','yml','php','asp','aspx','ico','woff','woff2','ttf','eot'):
            return 'endpoint'
    return 'endpoint'

def split_path_segments(path: str):
    path = (path or '/')
    path = re.sub(r'/+', '/', path)
    return [s for s in path.split('/') if s]


def main():
    if len(sys.argv) < 4:
        print('Usage: python3 import_dirsearch.py <website_url> <host> <json_path>')
        sys.exit(1)

    website_url = sys.argv[1].strip()
    host = sys.argv[2].strip()
    json_path = Path(sys.argv[3])

    if not json_path.exists():
        print(f'ERROR: JSON file not found: {json_path}')
        sys.exit(2)

    # Load dirsearch JSON. It can either be a dict with key "results" or a raw list
    raw = json.loads(json_path.read_text(encoding='utf-8', errors='replace'))
    results = raw.get('results') if isinstance(raw, dict) else raw
    if not isinstance(results, list):
        print('ERROR: Unexpected dirsearch JSON format (no list results)')
        sys.exit(3)

    db = sqlite3.connect(str(DB_PATH))
    inserted = 0
    try:
        website_id = ensure_website(db, website_url)

        # Ensure parent host node exists
        parent_id = get_node_id_by_value(db, website_id, host)
        if not parent_id:
            ntype = 'subdomain' if host != apex_of(host) else 'domain'
            parent_id = insert_node(db, website_id, host, ntype)

        for item in results:
            try:
                url_or_path = item.get('url') or item.get('path') or ''
                # Normalize into a path component
                try:
                    p = urlparse(url_or_path)
                    path = p.path or url_or_path
                except Exception:
                    path = url_or_path
                if not path.startswith('/'):
                    path = '/' + path
                segs = split_path_segments(path)
                cumulative = ''
                prev_id = parent_id
                for i, seg in enumerate(segs):
                    cumulative = cumulative + '/' + seg if cumulative else '/' + seg
                    node_value = f"{host}{cumulative}"
                    ntype = classify_type_from_segment(seg, is_last=(i == len(segs) - 1))
                    node_id = insert_node(db, website_id, node_value, ntype,
                                          status=item.get('status') or item.get('code'),
                                          size=item.get('contentLength') or item.get('length') or item.get('size'))
                    insert_rel(db, prev_id, node_id, 'contains')
                    prev_id = node_id
                inserted += 1
            except Exception:
                continue

        # Update a convenience counter on the parent host node if column exists
        try:
            db.execute('UPDATE nodes SET dirsearch_count = COALESCE(dirsearch_count, 0) + ? WHERE id = ?', (inserted, parent_id))
        except Exception:
            pass

        db.commit()
        print(f'Imported {inserted} dirsearch items for host {host} under website {website_url}')
    finally:
        db.close()


if __name__ == '__main__':
    main()
