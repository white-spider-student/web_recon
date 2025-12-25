#!/usr/bin/env python3
"""
url_to_tree.py [--json] <url1> [<url2> ...]

Parses URLs into a hierarchical tree:
- Root node: domain (example.com)
- Directory nodes: each path segment (science, items, ...)
- Endpoint node: final segment if it looks like a file (page1.php), else directory

Outputs a readable tree or JSON structure of nodes and edges.
"""
import sys
import re
import json
from urllib.parse import urlparse

FILE_EXTS = {
    'html','htm','php','asp','aspx','jsp','js','css','png','jpg','jpeg','gif','svg','ico',
    'pdf','xml','json','txt','csv','zip','gz','tar','rar','7z','mp4','woff','woff2','ttf','eot'
}

def normalize_url(u: str) -> str:
    s = (u or '').strip()
    # ensure scheme to help urlparse
    if not re.match(r'^https?://', s, flags=re.I):
        s = 'http://' + s
    return s


def split_segments(path: str):
    path = re.sub(r'/+', '/', path or '/')
    return [seg for seg in path.split('/') if seg]


def classify_segment(seg: str, is_last: bool) -> str:
    if not is_last:
        return 'directory'
    # last segment: decide endpoint vs directory
    if '.' in seg:
        ext = seg.split('.')[-1].lower()
        if ext in FILE_EXTS:
            return 'endpoint'
    return 'directory'


def url_to_tree(u: str):
    u = normalize_url(u)
    p = urlparse(u)
    host = (p.hostname or '').lower()
    segs = split_segments(p.path or '/')

    nodes = []
    edges = []

    # root domain/subdomain node
    root_id = host
    nodes.append({'id': root_id, 'value': host, 'type': 'domain' if host.count('.') == 1 else 'subdomain'})

    prev_id = root_id
    cumulative = ''
    for i, seg in enumerate(segs):
        cumulative = cumulative + '/' + seg if cumulative else '/' + seg
        node_id = f"{host}{cumulative}"
        ntype = classify_segment(seg, is_last=(i == len(segs) - 1))
        nodes.append({'id': node_id, 'value': node_id, 'type': ntype})
        edges.append({'source': prev_id, 'target': node_id, 'type': 'contains'})
        prev_id = node_id

    return {'nodes': nodes, 'edges': edges}


def main():
    if len(sys.argv) < 2:
        print('Usage: url_to_tree.py [--json] <url1> [<url2> ...]')
        sys.exit(1)
    as_json = False
    args = []
    for a in sys.argv[1:]:
        if a == '--json':
            as_json = True
        else:
            args.append(a)

    results = []
    for u in args:
        tree = url_to_tree(u)
        results.append({'url': u, **tree})

    if as_json:
        print(json.dumps(results, indent=2))
    else:
        for r in results:
            print(f"URL: {r['url']}")
            for n in r['nodes']:
                print(f"  [{n['type']}] {n['value']}")
            print("  Edges:")
            for e in r['edges']:
                print(f"    {e['source']} -> {e['target']} ({e['type']})")
            print()

if __name__ == '__main__':
    main()
