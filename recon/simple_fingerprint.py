#!/usr/bin/env python3
"""Lightweight fingerprinting script.
Usage: python3 simple_fingerprint.py <target>
Writes JSON to results/simple_fingerprint_<target>.json

This script performs simple HTTP(s) requests, collects headers, status, title,
redirects and runs a handful of regex heuristics for technologies.
"""
import sys
import json
import re
from pathlib import Path
from urllib.parse import urlparse
import socket
import ssl

try:
    import requests
except Exception:
    requests = None

# optional Wappalyzer integration
WAPPALYZER_AVAILABLE = False
try:
    try:
        from Wappalyzer import Wappalyzer, WebPage
    except Exception:
        from wappalyzer import Wappalyzer, WebPage
    WAPPALYZER_AVAILABLE = True
except Exception:
    WAPPALYZER_AVAILABLE = False

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RESULTS_DIR = PROJECT_ROOT / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_HEADERS = {"User-Agent": "Mozilla/5.0 (simple-fingerprint)"}

TECH_PATTERNS = {
    "cloudflare": [re.compile(r"cloudflare", re.I)],
    "nginx": [re.compile(r"nginx", re.I)],
    "apache": [re.compile(r"apache", re.I)],
    "wordpress": [re.compile(r"wp-content|wp-includes|WordPress", re.I)],
    "react": [re.compile(r"react\b", re.I)],
    "nginx": [re.compile(r"nginx", re.I)],
    "php": [re.compile(r"X-Powered-By:\s*PHP", re.I)],
}


def banner_probe(host: str, port: int, use_tls: bool = False, timeout: float = 3.0):
    """Try to connect to host:port and read a small banner. If use_tls=True wrap socket with SSL.
    Returns (ok: bool, banner: str or None, error: str or None).
    """
    try:
        addr_info = socket.getaddrinfo(host, port, family=socket.AF_UNSPEC, type=socket.SOCK_STREAM)
        family, socktype, proto, canonname, sockaddr = addr_info[0]
        s = socket.socket(family, socktype, proto)
        s.settimeout(timeout)
        s.connect(sockaddr)
        if use_tls:
            ctx = ssl.create_default_context()
            s = ctx.wrap_socket(s, server_hostname=host)
        # try a small read; some servers send banner immediately (e.g., SMTP), for HTTP send a simple HEAD
        try:
            # send minimal HTTP HEAD to elicit a Server header
            s.sendall(b"HEAD / HTTP/1.0\r\nHost: %b\r\n\r\n" % host.encode())
        except Exception:
            pass
        try:
            data = s.recv(2048)
        except Exception:
            data = b""
        s.close()
        text = data.decode(errors="replace") if data else None
        return True, text, None
    except Exception as e:
        return False, None, str(e)


def fetch_cert_info(host: str, timeout: float = 3.0):
    """Retrieve TLS certificate info from host:443. Returns dict or (None, error)."""
    try:
        pem = ssl.get_server_certificate((host, 443), timeout=timeout)
        try:
            # python's internal helper decodes PEM cert to dict
            cert = ssl._ssl._test_decode_cert(pem)
            return cert, None
        except Exception:
            return {"pem": pem}, None
    except Exception as e:
        return None, str(e)


def try_requests(url, timeout=10):
    if not requests:
        return None, "requests not installed"
    try:
        r = requests.get(url, headers=DEFAULT_HEADERS, timeout=timeout, allow_redirects=True)
        return r, None
    except Exception as e:
        return None, str(e)


def extract_title(html: str):
    m = re.search(r"<title>(.*?)</title>", html, re.I | re.S)
    return m.group(1).strip() if m else None


def detect_tech(headers: dict, body: str):
    found = []
    hdrs = "\n".join(f"{k}: {v}" for k, v in (headers or {}).items())
    for name, patterns in TECH_PATTERNS.items():
        for p in patterns:
            if p.search(hdrs) or (body and p.search(body)):
                found.append(name)
                break
    return sorted(set(found))


def clean_label(target: str):
    t = target.strip()
    t = re.sub(r"^https?://", "", t, flags=re.I)
    t = t.rstrip('/')
    return t


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 simple_fingerprint.py <target>")
        sys.exit(1)
    target = sys.argv[1]
    label = clean_label(target)
    out_path = RESULTS_DIR / f"simple_fingerprint_{label}.json"

    # try https then http
    candidates = []
    parsed = urlparse(target)
    if parsed.scheme:
        candidates.append(target)
    else:
        candidates.append(f"https://{label}")
        candidates.append(f"http://{label}")

    results = {
        "target": label,
        "probes": []
    }

    for url in candidates:
        probe = {"url": url, "ok": False, "error": None, "status_code": None, "headers": None, "title": None, "redirects": None, "body_snippet": None}
        probe["resolved_ip"] = None
        probe["response_time_ms"] = None
        probe["content_length"] = None
        probe["tls_cert"] = None
        r, err = try_requests(url)
        if err:
            probe["error"] = err
            results["probes"].append(probe)
            continue
        # record timings and resolved IP
        try:
            host = urlparse(url).hostname
            addr = socket.getaddrinfo(host, 0)[0][4][0]
            probe["resolved_ip"] = addr
        except Exception:
            probe["resolved_ip"] = None
        try:
            # response elapsed in seconds -> ms
            probe["response_time_ms"] = int(r.elapsed.total_seconds() * 1000)
        except Exception:
            probe["response_time_ms"] = None
        try:
            cl = r.headers.get("Content-Length")
            probe["content_length"] = int(cl) if cl and cl.isdigit() else None
        except Exception:
            probe["content_length"] = None
        probe["ok"] = True
        probe["status_code"] = r.status_code
        probe["headers"] = dict(r.headers)
        probe["title"] = extract_title(r.text)
        probe["redirects"] = [str(x) for x in r.history] if r.history else []
        probe["body_snippet"] = r.text[:800]
        probe["tech"] = detect_tech(probe["headers"], r.text)
        # optionally run Wappalyzer if available for richer tech detection
        probe["wappalyzer"] = None
        if WAPPALYZER_AVAILABLE:
            try:
                try:
                    # prefer analyze from response if available
                    page = None
                    try:
                        page = WebPage.new_from_response(r)
                    except Exception:
                        try:
                            page = WebPage.new_from_url(url)
                        except Exception:
                            page = None
                    if page is None:
                        probe["wappalyzer"] = {"error": "could not build WebPage object"}
                    else:
                        try:
                            w = None
                            try:
                                w = Wappalyzer.latest()
                            except Exception:
                                try:
                                    w = Wappalyzer()
                                except Exception:
                                    w = None
                            if not w:
                                probe["wappalyzer"] = {"error": "failed to initialize Wappalyzer"}
                            else:
                                techs = w.analyze(page)
                                probe["wappalyzer"] = {"technologies": techs}
                        except Exception as e:
                            probe["wappalyzer"] = {"error": str(e)}
                except Exception as e:
                    probe["wappalyzer"] = {"error": str(e)}
            except Exception:
                probe["wappalyzer"] = {"error": "unknown wappalyzer error"}
        else:
            probe["wappalyzer"] = {"error": "wappalyzer not installed"}
        # if Server header missing, try banner probes on ports 443 and 80 to guess server
        server_hdr = None
        try:
            server_hdr = probe["headers"].get("Server")
        except Exception:
            server_hdr = None
        probe["server_banner"] = None
        probe["banner_probe"] = []
        if not server_hdr:
            host = urlparse(url).hostname
            # TLS probe on 443
            ok, banner, err = banner_probe(host, 443, use_tls=True)
            probe["banner_probe"].append({"port": 443, "tls": True, "ok": ok, "banner": banner, "error": err})
            # fetch TLS cert info if TLS probe succeeded
            if ok:
                cert, cert_err = fetch_cert_info(host)
                if cert:
                    probe["tls_cert"] = cert
                else:
                    probe["tls_cert"] = {"error": cert_err}
            # plain probe on 80
            ok2, banner2, err2 = banner_probe(host, 80, use_tls=False)
            probe["banner_probe"].append({"port": 80, "tls": False, "ok": ok2, "banner": banner2, "error": err2})
            # try to extract server-like token from banners
            banners_text = "\n".join([b.get("banner") or "" for b in probe["banner_probe"]])
            if banners_text:
                m = re.search(r"Server:\s*([^\r\n]+)", banners_text, re.I)
                if m:
                    probe["server_banner"] = m.group(1).strip()
                else:
                    # fallback heuristic: look for common tokens
                    for token in ("nginx", "cloudflare", "apache", "caddy", "gunicorn"):
                        if re.search(token, banners_text, re.I):
                            probe["server_banner"] = token
                            break
        else:
            probe["server_banner"] = server_hdr
        results["probes"].append(probe)
        # stop after first successful probe
        break

    pretty = json.dumps(results, indent=2)
    # print a concise per-probe summary
    for p in results.get("probes", []):
        status = "OK" if p.get("ok") else "ERR"
        srv = p.get("server_banner") or (p.get("headers") or {}).get("Server") or "(unknown)"
        techs = ",".join(p.get("tech") or []) or "(none)"
        print(f"[{status}] {p.get('url')} server={srv} status={p.get('status_code')} techs={techs}")
    # print full JSON as well
    print(pretty)
    out_path.write_text(pretty)
    print(f"wrote: {out_path}")


if __name__ == "__main__":
    main()
