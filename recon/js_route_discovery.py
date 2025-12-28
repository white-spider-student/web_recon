#!/usr/bin/env python3
import re
import time
from dataclasses import dataclass
from typing import Dict, List, Set, Tuple
from urllib.parse import urljoin, urlparse

from recon.url_classify import classify_url, normalize_url

try:
    import requests
except Exception:
    requests = None

URL_REGEX = re.compile(r"https?://[^\s'\"\\)]+", re.I)
PATH_REGEX = re.compile(r"['\"](/[^'\"\\s]{3,})['\"]")
HASH_ROUTE_REGEX = re.compile(r"['\"]#(/[^'\"\\s]+)['\"]")
FETCH_REGEX = re.compile(r"(?:fetch|axios\\.(?:get|post|put|delete)|open)\\s*\\(\\s*['\"]([^'\"]+)['\"]", re.I)


@dataclass
class JsDiscoveryConfig:
    max_js_files: int = 5
    max_js_kb: int = 512
    rate_limit_s: float = 0.3
    whitelist: str = ""
    blacklist: str = ""


def _origin(base_url: str) -> str:
    p = urlparse(base_url)
    if not p.scheme or not p.netloc:
        return base_url
    return f"{p.scheme}://{p.netloc}"


def _classify_url(url: str) -> str:
    return classify_url(url)


def _normalize_candidate(raw: str, base_url: str) -> str:
    if not raw:
        return ""
    if raw.startswith("//"):
        return urlparse(base_url).scheme + ":" + raw
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    if raw.startswith("#/"):
        return urljoin(base_url, raw[1:])
    if raw.startswith("/"):
        return urljoin(base_url, raw)
    return ""


def extract_script_urls(html: str, base_url: str) -> List[str]:
    urls: Set[str] = set()
    for m in re.finditer(r"<script[^>]+src=['\"]([^'\"]+)['\"]", html, re.I):
        u = urljoin(base_url, m.group(1).strip())
        if u.startswith("http"):
            urls.add(u)
    return sorted(urls)


def _fetch_js(url: str, timeout: int, max_kb: int, headers: Dict[str, str]) -> str:
    if requests is None:
        return ""
    try:
        r = requests.get(url, headers=headers, timeout=timeout)
        if not r or r.status_code >= 400:
            return ""
        content = r.text or ""
        if len(content.encode("utf-8")) > max_kb * 1024:
            return ""
        return content
    except Exception:
        return ""


def extract_js_endpoints(js_text: str, base_url: str) -> Dict[str, Set[str]]:
    urls: Set[str] = set()
    routes: Set[str] = set()
    api: Set[str] = set()
    assets: Set[str] = set()
    feeds: Set[str] = set()

    for m in URL_REGEX.finditer(js_text):
        candidate = _normalize_candidate(m.group(0), base_url)
        if candidate:
            urls.add(candidate)

    for m in FETCH_REGEX.finditer(js_text):
        candidate = _normalize_candidate(m.group(1), base_url)
        if candidate:
            urls.add(candidate)

    for m in PATH_REGEX.finditer(js_text):
        candidate = _normalize_candidate(m.group(1), base_url)
        if candidate:
            urls.add(candidate)

    for m in HASH_ROUTE_REGEX.finditer(js_text):
        candidate = _normalize_candidate("#" + m.group(1), base_url)
        if candidate:
            routes.add(candidate)

    for u in urls:
        u = normalize_url(base_url, u)
        if not u:
            continue
        kind = _classify_url(u)
        if kind == "asset":
            assets.add(u)
        elif kind == "feed":
            feeds.add(u)
        elif kind == "api":
            api.add(u)
        else:
            routes.add(u)

    return {
        "routes": routes,
        "api": api,
        "assets": assets,
        "feeds": feeds
    }


def discover_js_routes(html: str, base_url: str, config: JsDiscoveryConfig, headers: Dict[str, str]) -> Tuple[Dict[str, List[str]], List[str]]:
    script_urls = extract_script_urls(html, base_url)
    if config.whitelist:
        script_urls = [u for u in script_urls if re.search(config.whitelist, u)]
    if config.blacklist:
        script_urls = [u for u in script_urls if not re.search(config.blacklist, u)]
    script_urls = script_urls[: config.max_js_files]

    buckets = {"routes": set(), "api": set(), "assets": set(), "feeds": set()}
    for u in script_urls:
        js_text = _fetch_js(u, timeout=10, max_kb=config.max_js_kb, headers=headers)
        if not js_text:
            continue
        found = extract_js_endpoints(js_text, base_url)
        for key in buckets:
            buckets[key].update(found.get(key, set()))
        if config.rate_limit_s:
            time.sleep(config.rate_limit_s)

    normalized = {k: sorted(list(v)) for k, v in buckets.items()}
    return normalized, script_urls
ASSET_NAME_HINTS = (
    "favicon", "apple-touch-icon", "manifest.json", "browserconfig.xml", "safari-pinned-tab.svg"
)
