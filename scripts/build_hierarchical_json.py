#!/usr/bin/env python3
"""
build_hierarchical_json.py <input_html_links_json> <output_json>

Reads an HTML links discovery JSON (like results/html_links_<domain>.json) and
produces a hierarchical JSON with domain/subdomain, directory nodes per segment,
final endpoints for file-like leaves, plus parent-child "contains" relationships.

This does NOT touch the database; it only generates a JSON artifact suitable for
visualization or further import.
"""
import sys
import json
import re
from pathlib import Path
from urllib.parse import urlparse

FILE_EXTS = {
    'html','htm','php','asp','aspx','jsp','js','css','png','jpg','jpeg','gif','svg','ico',
    'pdf','xml','json','txt','csv','zip','gz','tar','rar','7z','mp4','woff','woff2','ttf','eot'
}

def apex_of(host: str) -> str:
    host = (host or '').lower()
    parts = host.split('.')
    return '.'.join(parts[-2:]) if len(parts) >= 2 else host


def get_host(url_or_host: str) -> str:
    s = (url_or_host or '').strip()
    try:
        p = urlparse(s)
        if p.scheme and p.hostname:
            return p.hostname.lower()
    except Exception:
        pass
    s = re.sub(r'^https?://', '', s, flags=re.I)
    return (s.split('/')[0]).lower()


def split_segments(path: str):
    path = re.sub(r'/+', '/', path or '/')
    return [seg for seg in path.split('/') if seg]


def is_file_segment(seg: str) -> bool:
    if not seg or '.' not in seg:
        return False
    ext = seg.split('.')[-1].lower()
    return ext in FILE_EXTS


def add_node(nodes, value, ntype):
    if value in nodes:
        # keep earliest type; or prefer directory over endpoint for stability
        return
    nodes[value] = {'id': value, 'value': value, 'type': ntype}


def add_edge(edges, src, tgt):
    key = (src, tgt, 'contains')
    if key in edges:
        return
    edges[key] = {'source': src, 'target': tgt, 'type': 'contains'}


def build_hierarchy(discovered):
    urls = discovered.get('urls', []) or []
    nodes = {}
    edges = {}

    # Also include subdomains if provided
    for h in (discovered.get('subdomains') or []):
        add_node(nodes, h, 'subdomain' if h != apex_of(h) else 'domain')

    for raw in urls:
        try:
            p = urlparse(raw)
            host = (p.hostname or '').lower()
            if not host:
                host = get_host(raw)
            if not host:
                continue
            # ensure root host node exists
            add_node(nodes, host, 'subdomain' if host != apex_of(host) else 'domain')

            segs = split_segments(p.path or '/')
            prev = host
            cumulative = ''
            for i, seg in enumerate(segs):
                cumulative = cumulative + '/' + seg if cumulative else '/' + seg
                node_value = f"{host}{cumulative}"
                ntype = 'endpoint' if (i == len(segs) - 1 and is_file_segment(seg)) else 'directory'
                add_node(nodes, node_value, ntype)
                add_edge(edges, prev, node_value)
                prev = node_value
        except Exception:
            continue

    return {
        'nodes': list(nodes.values()),
        'relationships': list(edges.values())
    }


def main():
    if len(sys.argv) < 3:
        print('Usage: build_hierarchical_json.py <input_html_links_json> <output_json>')
        sys.exit(1)
    inp = Path(sys.argv[1])
    outp = Path(sys.argv[2])
    if not inp.exists():
        print(f'Input JSON not found: {inp}')
        sys.exit(2)
    try:
        data = json.loads(inp.read_text())
        discovered = data.get('discovered') or {}
        target = data.get('target') or ''
        hierarchy = build_hierarchy(discovered)
        out = {
            'website': {'url': target, 'name': target},
            **hierarchy
        }
        outp.parent.mkdir(parents=True, exist_ok=True)
        outp.write_text(json.dumps(out, indent=2))
        print(f'Wrote hierarchical JSON: {outp}')
    except Exception as e:
        print(f'ERROR: {e}')
        sys.exit(3)

if __name__ == '__main__':
    main()
