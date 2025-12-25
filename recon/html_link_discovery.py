#!/usr/bin/env python3
"""
html_link_discovery.py <target> [max_pages] [depth]

Fetches the homepage (and optionally a limited set of discovered pages) and parses
HTML to extract links (href/src) to:
- subdomains under the same apex domain
- directories on the same host

Writes JSON to results/html_links_<target>.json with:
{
  target, apex, pages_crawled, discovered: { subdomains: [], directories_by_host: {host:[paths]}, urls: [] }
}
"""
import sys
import json
import re
from collections import deque, defaultdict
from pathlib import Path
from urllib.parse import urlparse, urljoin

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RESULTS_DIR = PROJECT_ROOT / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

try:
    import requests
except Exception:  # requests may not be installed in some environments
    requests = None

try:
    from bs4 import BeautifulSoup  # type: ignore
except Exception:
    BeautifulSoup = None

DEFAULT_HEADERS = {"User-Agent": "Mozilla/5.0 (html-link-discovery)"}


def clean_label(target: str) -> str:
    t = target.strip()
    t = re.sub(r"^https?://", "", t, flags=re.I)
    t = t.rstrip('/')
    t = re.sub(r"[^A-Za-z0-9._-]", "_", t)
    return t


def apex_of(host: str) -> str:
    host = host.lower()
    # naive apex extraction: last two labels. Handles most typical domains.
    parts = host.split('.')
    if len(parts) >= 2:
        return '.'.join(parts[-2:])
    return host


def is_http_url(u: str) -> bool:
    return bool(re.match(r"^https?://", u, re.I))


def absolute_url(base: str, href: str) -> str:
    try:
        return urljoin(base, href)
    except Exception:
        return href


def extract_links(html: str, base_url: str):
    urls = set()
    if BeautifulSoup is not None:
        try:
            soup = BeautifulSoup(html, 'html.parser')
            attrs = ("href", "src", "action", "data", "poster")
            for tag in soup.find_all(True):
                for a in attrs:
                    v = tag.get(a)
                    if not v:
                        continue
                    u = absolute_url(base_url, str(v))
                    if is_http_url(u):
                        urls.add(u)
        except Exception:
            pass
    # fallback: basic regex for href/src
    if not urls:
        for m in re.finditer(r"(?:href|src)\s*=\s*['\"]([^'\"]+)['\"]", html, re.I):
            u = absolute_url(base_url, m.group(1))
            if is_http_url(u):
                urls.add(u)
    return urls


def crawl(start_urls, apex, max_pages=60, max_depth=1, timeout=8):
    visited = set()
    q = deque()
    for u in start_urls:
        q.append((u, 0))
    discovered_urls = set()
    subdomains = set()
    directories_by_host = defaultdict(set)

    while q and len(visited) < max_pages:
        url, depth = q.popleft()
        if url in visited:
            continue
        visited.add(url)
        discovered_urls.add(url)
        if requests is None:
            break
        try:
            r = requests.get(url, headers=DEFAULT_HEADERS, timeout=timeout, allow_redirects=True)
            ct = r.headers.get('Content-Type', '') if r and r.headers else ''
            if r.status_code >= 400:
                continue
            if 'text/html' not in ct.lower() and '<html' not in (r.text or '').lower():
                continue
            links = extract_links(r.text or '', r.url)
            for link in links:
                try:
                    p = urlparse(link)
                except Exception:
                    continue
                if not p.scheme.startswith('http'):
                    continue
                host = (p.hostname or '').lower()
                if not host:
                    continue
                # classify by host
                if host.endswith('.' + apex) and host != apex:
                    subdomains.add(host)
                elif host == apex:
                    # same host (root). collect directory path of this link
                    if p.path:
                        segs = [s for s in p.path.split('/') if s]
                        if segs:
                            directories_by_host[host].add('/' + segs[0])
                else:
                    # external domain - ignore
                    pass
                # schedule follow if within same apex and depth allows
                if depth < max_depth and (host == apex or host.endswith('.' + apex)):
                    next_url = link
                    if next_url not in visited:
                        q.append((next_url, depth + 1))
        except Exception:
            continue

    # serialize sets
    dirs_serialized = {h: sorted(list(vs)) for h, vs in directories_by_host.items()}
    return {
        "pages_crawled": len(visited),
        "discovered": {
            "subdomains": sorted(list(subdomains)),
            "directories_by_host": dirs_serialized,
            "urls": sorted(list(discovered_urls)),
        }
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 html_link_discovery.py <target> [max_pages] [depth]")
        sys.exit(1)
    target = sys.argv[1]
    try:
        max_pages = int(sys.argv[2]) if len(sys.argv) >= 3 else 60
    except Exception:
        max_pages = 60
    try:
        depth = int(sys.argv[3]) if len(sys.argv) >= 4 else 1
    except Exception:
        depth = 1

    # Build start URLs for http/https if scheme missing
    parsed = urlparse(target)
    if parsed.scheme:
        start = [target]
        host = parsed.hostname or target
    else:
        host = target
        start = [f"https://{host}", f"http://{host}"]

    apex = apex_of(host)

    result = {
        "target": host,
        "apex": apex,
        "start": start,
    }

    data = crawl(start, apex, max_pages=max_pages, max_depth=depth)
    result.update(data)

    label = clean_label(host)
    out_path = RESULTS_DIR / f"html_links_{label}.json"
    pretty = json.dumps(result, indent=2)
    print(pretty)
    out_path.write_text(pretty)
    print(f"wrote: {out_path}")


if __name__ == "__main__":
    main()
