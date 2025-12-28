#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from recon.html_link_discovery import extract_links, extract_search_targets, classify_url
from recon.js_route_discovery import extract_script_urls


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 scripts/self_check_html_discovery.py <html_file> <base_url>")
        sys.exit(1)
    html_path = Path(sys.argv[1])
    base_url = sys.argv[2]
    if not html_path.exists():
        print(f"HTML file not found: {html_path}")
        sys.exit(2)
    html = html_path.read_text(encoding="utf-8", errors="ignore")

    links = extract_links(html, base_url)
    scripts = extract_script_urls(html, base_url)
    search_targets = extract_search_targets(html)

    buckets = {"pages": [], "api": [], "feeds": [], "assets": []}
    for link in sorted(links):
        kind = classify_url(link)
        if kind in buckets:
            buckets[kind].append(link)
        else:
            buckets["pages"].append(link)

    report = {
        "base": base_url,
        "script_urls": scripts,
        "search_targets": search_targets,
        "pages": buckets["pages"],
        "api": buckets["api"],
        "feeds": buckets["feeds"],
        "assets": buckets["assets"]
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
