#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from recon.url_classify import classify_url


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 recon/debug_classify_urls.py <html_links.json>")
        sys.exit(1)
    path = Path(sys.argv[1])
    if not path.exists():
        print(f"File not found: {path}")
        sys.exit(2)
    data = json.loads(path.read_text())
    discovered = data.get("discovered") or {}
    urls = []
    for key in ("urls", "pages", "api", "assets", "feeds", "routes", "query_urls"):
        urls.extend(discovered.get(key) or [])
    counts = {}
    for u in urls:
        t = classify_url(u)
        counts[t] = counts.get(t, 0) + 1
    print("Counts by type:")
    for k in sorted(counts.keys()):
        print(f"  {k}: {counts[k]}")


if __name__ == "__main__":
    main()
