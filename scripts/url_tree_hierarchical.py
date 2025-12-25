#!/usr/bin/env python3
"""
url_tree_hierarchical.py <domain> <input_json> <output_json>

Build a clean hierarchical tree from discovered URLs where:
- Root is the domain (hostname)
- Each path segment becomes a child node
- Final leaf classified as endpoint if it ends with one of: .php, .html, .asp, .aspx, .json, .xml
- Reuse existing directory nodes (no duplicates)
- Never include full URLs as nodes

Input JSON shape (from html_link_discovery.py):
{
  "target": "<domain>",
  "discovered": {
    "urls": [ "https://<host>/<path>", ... ]
  }
}

Output JSON shape:
{
  "domain": "<domain>",
  "children": [ { "name": "segment", "children": [...] }, ... ]
}
"""
import sys
import json
from urllib.parse import urlparse

ENDPOINT_EXTS = {"php","html","asp","aspx","json","xml"}

class Node:
    __slots__ = ("name","type","children")
    def __init__(self, name: str, ntype: str|None=None):
        self.name = name
        self.type = ntype
        self.children: list[Node] = []
    def to_obj(self):
        obj = {"name": self.name}
        if self.type:
            obj["type"] = self.type
        if self.children:
            obj["children"] = [c.to_obj() for c in self.children]
        return obj

def insert_path(root: Node, segments: list[str]):
    cur = root
    for i, seg in enumerate(segments):
        is_last = (i == len(segments) - 1)
        # classify last segment as endpoint by extension
        ntype = None
        if is_last:
            ext = seg.split(".")[-1].lower() if "." in seg else ""
            if ext in ENDPOINT_EXTS:
                ntype = "endpoint"
        # find or create child
        nxt = None
        for c in cur.children:
            if c.name == seg:
                nxt = c
                break
        if not nxt:
            nxt = Node(seg, ntype)
            cur.children.append(nxt)
        else:
            # upgrade type if now determined as endpoint
            if ntype and not nxt.type:
                nxt.type = ntype
        cur = nxt

def main():
    if len(sys.argv) < 4:
        print("Usage: python3 scripts/url_tree_hierarchical.py <domain> <input_json> <output_json>")
        sys.exit(1)
    domain = sys.argv[1].strip()
    input_path = sys.argv[2].strip()
    output_path = sys.argv[3].strip()

    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    urls = []
    try:
        urls = (data.get("discovered", {}) or {}).get("urls", []) or []
    except Exception:
        urls = []

    # Root node holds only children; top-level object carries domain
    root = Node(domain)
    root_children = []
    root.children = root_children

    for u in urls:
        try:
            p = urlparse(u)
            host = (p.hostname or "").lower()
            if not host or host != domain:
                # Only include URLs under the specified domain root
                continue
            segs = [s for s in (p.path or "").split("/") if s]
            if not segs:
                continue
            insert_path(root, segs)
        except Exception:
            continue

    out = {
        "domain": domain,
        "children": [c.to_obj() for c in root.children]
    }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"Wrote hierarchical tree to {output_path}")

if __name__ == "__main__":
    main()
