#!/usr/bin/env python3
"""
html_link_discovery.py <target> [max_pages] [depth]

Fetches the homepage (and optionally a limited set of discovered pages) and parses
HTML to extract links (href/src) to:
- subdomains under the same apex domain
- directories on the same host

Writes JSON to results/html_links_<target>.json with:
{
  target, apex, pages_crawled,
  discovered: {
    subdomains: [],
    directories_by_host: {host:[paths]},
    urls: [],
    pages: [],
    api: [],
    feeds: [],
    assets: [],
    routes: [],
    js_files: [],
    requests: [],
    query_urls: []
  }
}
"""
import sys
import json
import re
import argparse
import time
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

try:
    from recon.js_route_discovery import JsDiscoveryConfig, discover_js_routes
    from recon.url_classify import classify_url, normalize_url
except Exception:
    JsDiscoveryConfig = None
    discover_js_routes = None
    classify_url = None
    normalize_url = None



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


def extract_search_targets(html: str):
    targets = set()
    for m in re.finditer(r'"target"\s*:\s*"([^"]+)"', html, re.I):
        targets.add(m.group(1))
    return sorted(targets)


def normalize_existing(u: str) -> str:
    if normalize_url is None:
        return u
    return normalize_url(u, u)


def build_query_urls(base_url: str, seeds):
    urls = []
    for q in seeds:
        qv = str(q).strip()
        if not qv:
            continue
        if "?" in base_url:
            urls.append(f"{base_url}&query={qv}")
        else:
            urls.append(f"{base_url}?query={qv}")
    return urls


def headless_discover(start_url: str, timeout_ms: int = 12000, max_requests: int = 200):
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return "", []
    requests = set()
    html = ""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("request", lambda req: requests.add(req.url) if len(requests) < max_requests else None)
        page.goto(start_url, wait_until="networkidle", timeout=timeout_ms)
        html = page.content()
        browser.close()
    return html, sorted(requests)


def crawl(start_urls, apex, max_pages=60, max_depth=1, timeout=8, js_config=None, seed_queries=None, rate_limit_s=0.3, headless=False):
    visited = set()
    q = deque()
    for u in start_urls:
        q.append((u, 0))
    discovered_urls = set()
    pages = set()
    api = set()
    feeds = set()
    assets = set()
    routes = set()
    js_files = set()
    query_urls = set()
    network_requests = set()
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
            html = r.text or ''
            pages.add(r.url)
            links = extract_links(html, r.url)
            if seed_queries:
                for qurl in build_query_urls(r.url, seed_queries):
                    query_urls.add(qurl)
                    pages.add(qurl)
            for target in extract_search_targets(html):
                candidate = absolute_url(r.url, target)
                if is_http_url(candidate):
                    pages.add(candidate)
            if js_config is not None and discover_js_routes is not None:
                js_result, scripts = discover_js_routes(html, r.url, js_config, DEFAULT_HEADERS)
                js_files.update(scripts)
                for u in js_result.get("routes", []):
                    routes.add(u)
                for u in js_result.get("api", []):
                    api.add(u)
                for u in js_result.get("feeds", []):
                    feeds.add(u)
                for u in js_result.get("assets", []):
                    assets.add(u)
            if headless:
                h_html, h_requests = headless_discover(r.url)
                if h_html:
                    h_links = extract_links(h_html, r.url)
                    links.update(h_links)
                for req in h_requests:
                    network_requests.add(req)
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
                if host != apex and not host.endswith('.' + apex):
                    continue
                if classify_url is None:
                    kind = "page"
                else:
                    kind = classify_url(link)
                if kind == "asset":
                    assets.add(link)
                elif kind == "feed":
                    feeds.add(link)
                elif kind == "api":
                    api.add(link)
                else:
                    pages.add(link)
                # classify by host
                if host.endswith('.' + apex) and host != apex:
                    subdomains.add(host)
                elif host == apex:
                    # same host (root). collect directory path of this link if it's a page/api
                    if kind in ("page", "api") and p.path:
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
            if rate_limit_s:
                time.sleep(rate_limit_s)
        except Exception:
            continue

    # serialize sets
    dirs_serialized = {h: sorted(list(vs)) for h, vs in directories_by_host.items()}
    pages_clean = sorted({normalize_existing(u) for u in pages.union(routes) if normalize_existing(u)})
    api_clean = sorted({normalize_existing(u) for u in api if normalize_existing(u)})
    feeds_clean = sorted({normalize_existing(u) for u in feeds if normalize_existing(u)})
    assets_clean = sorted({normalize_existing(u) for u in assets if normalize_existing(u)})
    routes_clean = sorted({normalize_existing(u) for u in routes if normalize_existing(u)})
    return {
        "pages_crawled": len(visited),
        "discovered": {
            "subdomains": sorted(list(subdomains)),
            "directories_by_host": dirs_serialized,
            "urls": pages_clean,
            "pages": pages_clean,
            "api": api_clean,
            "feeds": feeds_clean,
            "assets": assets_clean,
            "routes": routes_clean,
            "js_files": sorted(list(js_files)),
            "requests": sorted(list(network_requests)),
            "query_urls": sorted(list(query_urls)),
        }
    }


def main():
    parser = argparse.ArgumentParser(description="Crawl HTML and extract links and JS routes")
    parser.add_argument("target")
    parser.add_argument("max_pages", nargs="?", type=int, default=60)
    parser.add_argument("depth", nargs="?", type=int, default=1)
    parser.add_argument("--max-js", type=int, default=5, help="Max JS files to analyze")
    parser.add_argument("--max-js-size-kb", type=int, default=512, help="Max JS size in KB")
    parser.add_argument("--js-whitelist", default="", help="Regex whitelist for JS URLs")
    parser.add_argument("--js-blacklist", default="", help="Regex blacklist for JS URLs")
    parser.add_argument("--seed-queries", default="sql,cve-2024,rce,wordpress", help="Comma-separated seed queries")
    parser.add_argument("--rate-limit-ms", type=int, default=300, help="Delay between requests")
    parser.add_argument("--headless", action="store_true", help="Enable headless render discovery (Playwright)")
    args = parser.parse_args()

    target = args.target
    max_pages = args.max_pages
    depth = args.depth
    seed_queries = [s.strip() for s in (args.seed_queries or "").split(",") if s.strip()]
    rate_limit_s = max(0.0, args.rate_limit_ms / 1000.0)

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

    js_config = None
    if JsDiscoveryConfig is not None:
        js_config = JsDiscoveryConfig(
            max_js_files=args.max_js,
            max_js_kb=args.max_js_size_kb,
            whitelist=args.js_whitelist,
            blacklist=args.js_blacklist,
            rate_limit_s=rate_limit_s
        )
    data = crawl(
        start,
        apex,
        max_pages=max_pages,
        max_depth=depth,
        js_config=js_config,
        seed_queries=seed_queries,
        rate_limit_s=rate_limit_s,
        headless=args.headless
    )
    result.update(data)

    label = clean_label(host)
    out_path = RESULTS_DIR / f"html_links_{label}.json"
    pretty = json.dumps(result, indent=2)
    print(pretty)
    out_path.write_text(pretty)
    print(f"wrote: {out_path}")


if __name__ == "__main__":
    main()
