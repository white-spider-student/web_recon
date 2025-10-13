#!/usr/bin/env python3
"""
Simple baseline filter for dirsearch JSON results.
Usage: python scripts/filter_dirsearch_baseline.py <host>
This script probes a couple of non-existent paths on the host to compute a baseline
response signature, then removes dirsearch results that match the baseline by
status and content length.
"""
import sys
import json
import hashlib
from pathlib import Path
import requests

RESULTS = Path(__file__).resolve().parent.parent / 'results'
TIMEOUT = 3


def fingerprint_response(resp):
    body = resp.content or b""
    return {
        'status': resp.status_code,
        'length': len(body),
        'ctype': resp.headers.get('Content-Type',''),
        'sha256': hashlib.sha256(body).hexdigest() if body else ''
    }


def probe_baseline(host):
    urls = [f"http://{host}/this-path-should-not-exist-12345", f"http://{host}/nonexistent-{abs(hash(host))%100000}"]
    fps = []
    for u in urls:
        try:
            r = requests.get(u, timeout=TIMEOUT, allow_redirects=True)
            fps.append(fingerprint_response(r))
        except Exception:
            fps.append(None)
    for f in fps:
        if f:
            return f
    return None


def load_dirsearch(path: Path):
    text = path.read_text(encoding='utf-8', errors='replace')
    try:
        return json.loads(text)
    except Exception:
        return None


def filter_dirsearch(path: Path, baseline):
    data = load_dirsearch(path)
    if data is None:
        print('invalid json', path)
        return False
    results = data.get('results') if isinstance(data, dict) else data
    if not isinstance(results, list):
        print('unexpected format', path)
        return False
    cleaned = []
    removed = 0
    for item in results:
        st = item.get('status')
        length = item.get('contentLength') or item.get('length') or 0
        if baseline and st == baseline['status'] and length == baseline['length']:
            removed += 1
            continue
        cleaned.append(item)
    out = dict(data) if isinstance(data, dict) else {}
    out['results'] = cleaned
    out_path = path.with_name(path.stem + '.clean.json')
    out_path.write_text(json.dumps(out, indent=2))
    print(f'Filtered {removed} entries from {path.name} -> {out_path.name}')
    return True


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: filter_dirsearch_baseline.py <host>')
        sys.exit(1)
    host = sys.argv[1]
    path = RESULTS / f'dirsearch_{host}.json'
    if not path.exists():
        print('no file for', host)
        sys.exit(2)
    baseline = probe_baseline(host)
    print('baseline:', baseline)
    filter_dirsearch(path, baseline)
