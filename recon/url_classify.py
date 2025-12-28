#!/usr/bin/env python3
import re
from urllib.parse import urlparse, urljoin

ASSET_EXTS = {
    "js","css","png","jpg","jpeg","gif","svg","ico","webp","woff","woff2","ttf","eot",
    "map","mp4","webm","mp3","wav","pdf","zip","gz","tar","rar","7z","xml","txt","json"
}

ASSET_PATH_HINTS = ("/static/", "/assets/", "/images/", "/img/", "/fonts/", "/cdn-cgi/")
API_HINTS = ("/api/", "/graphql", "/v1/", "/v2/", "/search", "/query", "/autocomplete")
FEED_HINTS = ("/rss", "/atom")
ASSET_NAME_HINTS = (
    "favicon", "apple-touch-icon", "manifest.json", "browserconfig.xml", "safari-pinned-tab.svg"
)


def normalize_url(base: str, raw: str) -> str:
    if not raw:
        return ""
    try:
        if raw.startswith("//"):
            parsed = urlparse(base)
            raw = f"{parsed.scheme}:{raw}"
        absolute = urljoin(base, raw)
        p = urlparse(absolute)
        if not p.scheme or not p.netloc:
            return ""
        return p._replace(fragment="").geturl()
    except Exception:
        return ""


def classify_url(url: str) -> str:
    try:
        p = urlparse(url)
    except Exception:
        return "other"
    path = (p.path or "").lower()
    name = path.rsplit("/", 1)[-1]

    if any(path.endswith(h) for h in FEED_HINTS):
        return "feed"
    if name == "robots.txt" or name == "sitemap.xml":
        return "page"
    if any(h in name for h in ASSET_NAME_HINTS):
        return "asset"
    if any(h in path for h in ASSET_PATH_HINTS):
        return "asset"

    ext = path.rsplit(".", 1)[-1] if "." in path else ""
    if ext in ("xml", "txt"):
        if name in ("robots.txt", "sitemap.xml"):
            return "page"
        return "asset"
    if ext == "json":
        if any(h in path for h in API_HINTS):
            return "api"
        return "asset"
    if ext in ASSET_EXTS:
        return "asset"

    if any(h in path for h in API_HINTS):
        return "api"
    return "page"


def is_asset(url: str) -> bool:
    return classify_url(url) == "asset"


def should_graph(url_type: str) -> bool:
    return url_type in ("page", "api")
