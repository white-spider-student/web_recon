import os
import json
import argparse
from pathlib import Path


def classify_finding(finding):
    """Classify a ffuf finding as 'directory' or 'file' and return simplified info.

    Normalize the path field so it contains only the URL path (leading slash),
    and set directory paths to end with '/'.
    """
    from urllib.parse import urlparse

    # ffuf records often include 'input' with 'FUZZ' and direct 'url', 'status', 'length'
    raw_path = ''
    if isinstance(finding.get('input'), dict):
        raw_path = finding.get('input', {}).get('FUZZ', '') or ''
    elif isinstance(finding.get('input'), str):
        raw_path = finding.get('input') or ''

    url = finding.get('url', '') or ''
    status = finding.get('status', 0) or 0
    length = finding.get('length', 0) or 0

    # If raw_path looks like a full URL, extract path; otherwise if url present, use its path
    path = ''
    try:
        if isinstance(raw_path, str) and raw_path.startswith('http'):
            path = urlparse(raw_path).path or ''
        elif url:
            path = urlparse(url).path or ''
        else:
            path = raw_path
    except Exception:
        path = raw_path or ''

    # ensure leading slash for paths that look like paths
    if path and not path.startswith('/'):
        path = '/' + path

    # Determine if directory: ends with / or last segment has no dot
    last_segment = path.split('/')[-1] if path else ''
    is_directory = False
    if path.endswith('/') or (last_segment and '.' not in last_segment):
        is_directory = True

    # normalize directory paths to end with '/'
    if is_directory and path and not path.endswith('/'):
        path = path + '/'

    info = {
        'url': url,
        'path': path,
        'status': status,
        'length': length,
    }
    return ('directory', info) if is_directory else ('file', info)


def process_ffuf_dirs(raw_path: Path, clean_path: Path):
    with raw_path.open() as f:
        data = json.load(f)
    findings = data.get('results') or data.get('findings') or []
    directories = []
    files = []
    for finding in findings:
        kind, info = classify_finding(finding)
        if kind == 'directory':
            directories.append(info)
        else:
            files.append(info)
    clean_obj = {'directories': directories, 'files': files}
    with clean_path.open('w') as f:
        json.dump(clean_obj, f, indent=2)
    print(f"Cleaned: {clean_path}")


def process_subdomains(raw_path: Path, clean_path: Path):
    with raw_path.open() as f:
        data = json.load(f)
    # ffuf_subs output may include different keys; try common ones
    subs = []
    if isinstance(data, dict):
        # possible shapes: {'subdomains': [...] } or ffuf results with 'results'
        if 'subdomains' in data:
            subs = data.get('subdomains') or []
        elif 'results' in data:
            for item in data.get('results', []):
                host = item.get('host') or None
                url = item.get('url') or item.get('input') or ''
                if host:
                    subs.append(host)
                elif url:
                    # extract hostname
                    try:
                        import re

                        m = re.search(r"https?://([^/]+)", url)
                        if m:
                            subs.append(m.group(1))
                    except Exception:
                        pass
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, str):
                subs.append(item)

    subs = sorted(set([s.strip().lower() for s in subs if s]))
    with clean_path.open('w') as f:
        json.dump({'subdomains': subs}, f, indent=2)
    print(f"Cleaned subdomains: {clean_path} ({len(subs)} entries)")


def detect_and_clean_one(raw_path: Path, clean_dir: Path):
    name = raw_path.name
    clean_dir.mkdir(parents=True, exist_ok=True)
    if name.startswith('ffuf_dirs_') and name.endswith('.json'):
        # example: ffuf_dirs_http_waitbutwhy_com_20250911-194836.json
        parts = name.split('_')
        # Find protocol and domain heuristically
        protocol = parts[2] if len(parts) > 2 else 'http'
        # domain may contain underscores instead of dots
        domain_fragment = parts[3] if len(parts) > 3 else 'unknown'
        domain = domain_fragment.replace('.json', '').replace('_', '.')
        clean_name = f"dirs_{protocol}_{domain}.json"
        process_ffuf_dirs(raw_path, clean_dir / clean_name)
    elif name.startswith('ffuf_subs_') and name.endswith('.json'):
        domain_fragment = name.split('ffuf_subs_')[1].replace('.json', '')
        domain = domain_fragment.replace('_', '.')
        clean_name = f"subs_{domain}.json"
        process_subdomains(raw_path, clean_dir / clean_name)
    elif name.startswith('subdomains_') and name.endswith('.json'):
        domain = name.split('subdomains_')[1].replace('.json', '')
        clean_name = f"subs_{domain}.json"
        process_subdomains(raw_path, clean_dir / clean_name)
    elif name.startswith('nmap') and (name.endswith('.json') or name.endswith('.xml') or name.endswith('.txt')):
        # Attempt to parse nmap JSON or XML output, produce a small summary
        from xml.etree import ElementTree

        def parse_nmap_xml(p: Path):
            try:
                tree = ElementTree.parse(p)
                root = tree.getroot()
                hosts = []
                for host in root.findall('host'):
                    addr = host.find('address')
                    hostname = host.find('hostnames/hostname')
                    addrv = addr.attrib.get('addr') if addr is not None else None
                    hname = hostname.attrib.get('name') if hostname is not None else None
                    ports = []
                    for port in host.findall('.//port'):
                        portid = port.attrib.get('portid')
                        state = port.find('state').attrib.get('state') if port.find('state') is not None else None
                        service = port.find('service')
                        svc = service.attrib.get('name') if service is not None else None
                        ports.append({'port': portid, 'state': state, 'service': svc})
                    hosts.append({'addr': addrv, 'hostname': hname, 'ports': ports})
                return {'hosts': hosts}
            except Exception as e:
                return {'error': str(e)}

        def parse_nmap_json(p: Path):
            try:
                with p.open() as f:
                    data = json.load(f)
                # nmap JSON from some tools stores scans under 'scan' or directly
                hosts = []
                if isinstance(data, dict):
                    for h, info in data.get('scan', {}).items():
                        ports = []
                        for portinfo in info.get('tcp', {}).values() if info.get('tcp') else []:
                            ports.append({'port': portinfo.get('portid'), 'state': portinfo.get('state'), 'service': portinfo.get('service', {}).get('name') if isinstance(portinfo.get('service'), dict) else None})
                        hosts.append({'addr': h, 'ports': ports})
                return {'hosts': hosts}
            except Exception as e:
                return {'error': str(e)}

        if name.endswith('.xml'):
            out = parse_nmap_xml(raw_path)
        else:
            out = parse_nmap_json(raw_path)
        clean_name = name.replace('.xml', '.json')
        with (clean_dir / clean_name).open('w') as f:
            json.dump(out, f, indent=2)
        print(f"Cleaned nmap: {clean_dir / clean_name}")

    elif name.startswith('whatweb') and (name.endswith('.json') or name.endswith('.txt')):
        # whatweb text output often contains a 'Results saved to: <path>' line
        if name.endswith('.json'):
            with raw_path.open() as f:
                data = json.load(f)
            out = {'whatweb': data}
        else:
            text = raw_path.read_text()
            lines = [l.strip() for l in text.splitlines() if l.strip()]
            # try to find 'Results saved to: <path>' and load that JSON if available
            result_file = None
            for l in lines:
                if 'Results saved to:' in l:
                    parts = l.split(':', 1)
                    if len(parts) > 1:
                        candidate = parts[1].strip()
                        # if path refers to a file inside results/, try to load it
                        if candidate and Path(candidate).exists():
                            result_file = Path(candidate)
                            break
            if result_file:
                try:
                    with result_file.open() as f:
                        loaded = json.load(f)
                    out = {'whatweb_result_file': str(result_file), 'whatweb': loaded}
                except Exception as e:
                    out = {'whatweb_lines': lines, 'error_loading_result_file': str(e)}
            else:
                # produce a compact structured summary: scanned URLs and first/last status
                scanned = []
                for l in lines:
                    if l.startswith('[whatweb] Scanning'):
                        scanned.append(l.split('[whatweb] Scanning', 1)[1].strip())
                out = {'scanned': scanned, 'raw_lines_count': len(lines)}
        clean_name = name.replace('.txt', '.json')
        with (clean_dir / clean_name).open('w') as f:
            json.dump(out, f, indent=2)
        print(f"Cleaned whatweb: {clean_dir / clean_name}")

    elif name.startswith('webanalyze') and (name.endswith('.json') or name.endswith('.txt')):
        if name.endswith('.json'):
            with raw_path.open() as f:
                data = json.load(f)
            out = {'webanalyze': data}
        else:
            # try to parse key: value lines
            lines = [l.strip() for l in raw_path.read_text().splitlines() if l.strip()]
            parsed = {}
            for l in lines:
                if ':' in l:
                    k, v = l.split(':', 1)
                    parsed[k.strip()] = v.strip()
            out = {'parsed': parsed, 'raw_lines': lines}
        clean_name = name.replace('.txt', '.json')
        with (clean_dir / clean_name).open('w') as f:
            json.dump(out, f, indent=2)
        print(f"Cleaned webanalyze: {clean_dir / clean_name}")

    elif name.startswith('simple_fingerprint') and name.endswith('.json'):
        try:
            with raw_path.open() as f:
                data = json.load(f)
            target = data.get('target') if isinstance(data, dict) else None
            probes = data.get('probes') if isinstance(data, dict) else (data if isinstance(data, list) else [])
            primary = probes[0] if probes else {}
            primary_summary = {
                'url': primary.get('url'),
                'ok': primary.get('ok'),
                'status_code': primary.get('status_code'),
                'resolved_ip': primary.get('resolved_ip'),
                'response_time_ms': primary.get('response_time_ms'),
                'content_length': primary.get('content_length'),
                'title': primary.get('title'),
                'headers': primary.get('headers'),
                'tech': primary.get('tech'),
                'wappalyzer': primary.get('wappalyzer'),
                'server_banner': primary.get('server_banner'),
                'banner_probe': primary.get('banner_probe'),
                'tls_cert': primary.get('tls_cert')
            }
            out = {'target': target, 'primary_probe': primary_summary, 'all_probes': probes}
            # Also emit a concise per-host summary file for easy consumption by visualization scripts
            try:
                if target:
                    summary = {
                        'target': target,
                        'status': primary_summary.get('status_code'),
                        'content_length': primary_summary.get('content_length'),
                        'ip': primary_summary.get('resolved_ip'),
                        'response_time_ms': primary_summary.get('response_time_ms'),
                        'title': primary_summary.get('title'),
                        'headers': primary_summary.get('headers'),
                        'technologies': primary_summary.get('tech') or [],
                        'wappalyzer': primary_summary.get('wappalyzer'),
                        'tls_cert': None
                    }
                    tls = primary_summary.get('tls_cert') or {}
                    if isinstance(tls, dict):
                        # try to extract simple cert summary fields if present
                        pem = tls.get('pem')
                        if pem:
                            # attempt to find commonName and dates heuristically from pem or tls dict
                            cn = None
                            valid_from = None
                            valid_to = None
                            # some scanners include parsed fields, try those
                            if tls.get('subject') and isinstance(tls.get('subject'), dict):
                                cn = tls.get('subject').get('commonName')
                            if not cn and isinstance(tls.get('pem'), str):
                                # skip heavy parsing; downstream can parse full pem if needed
                                cn = None
                            # certificate dates may be available under tls keys
                            valid_from = tls.get('not_valid_before') or tls.get('valid_from')
                            valid_to = tls.get('not_valid_after') or tls.get('valid_to')
                            summary['tls_cert'] = {'common_name': cn, 'valid_from': valid_from, 'valid_to': valid_to}
                    # write summary file
                    summary_name = f"summary_{target}.json"
                    with (clean_dir / summary_name).open('w') as sf:
                        json.dump(summary, sf, indent=2)
            except Exception:
                # non-fatal; visualization can fallback to reading full simple_fingerprint file
                pass
        except Exception as e:
            out = {'error': 'failed_to_parse_simple_fingerprint', 'exception': str(e), 'raw_text': raw_path.read_text()}
        clean_name = name
        with (clean_dir / clean_name).open('w') as f:
            json.dump(out, f, indent=2)
        print(f"Cleaned simple_fingerprint: {clean_dir / clean_name}")

    elif name.startswith('dirsearch') and name.endswith('.txt'):
        # dirsearch CLI outputs plain text; try to extract found paths
        lines = [l.rstrip() for l in raw_path.read_text().splitlines()]
        findings = []
        for l in lines:
            # look for URL-like results or status lines
            if l.startswith('URL:') or l.startswith('Found:') or l.startswith('  |- '):
                findings.append(l)
            else:
                # try simple URL
                if l.startswith('http://') or l.startswith('https://'):
                    findings.append(l)
        out = {'lines': lines, 'findings': findings}
        clean_name = name.replace('.txt', '.json')
        with (clean_dir / clean_name).open('w') as f:
            json.dump(out, f, indent=2)
        print(f"Cleaned dirsearch: {clean_dir / clean_name}")
    elif name.startswith('dirsearch') and name.endswith('.json'):
        # dirsearch produced JSON report; load and produce a small summary
        try:
            with raw_path.open() as f:
                data = json.load(f)
            # try to extract found entries (formats vary)
            findings = []
            if isinstance(data, dict):
                # common keys: 'results', 'paths', 'items'
                for key in ('results', 'paths', 'items', 'responses'):
                    if key in data and isinstance(data[key], list):
                        for entry in data[key]:
                            if isinstance(entry, dict):
                                url = entry.get('url') or entry.get('path') or entry.get('uri')
                                status = entry.get('status') or entry.get('code') or entry.get('length')
                                findings.append({'url': url, 'status': status})
            # fallback: put full JSON under 'raw'
            out = {'summary_count': len(findings), 'findings': findings, 'raw': data}
        except Exception as e:
            out = {'error': 'failed_to_parse_dirsearch_json', 'exception': str(e), 'raw_text': raw_path.read_text()}
        clean_name = name
        with (clean_dir / clean_name).open('w') as f:
            json.dump(out, f, indent=2)
        print(f"Cleaned dirsearch json: {clean_dir / clean_name}")

    else:
        # Fallback: always produce a JSON file with raw text and minimal metadata
        try:
            text = raw_path.read_text()
            lines = [l for l in text.splitlines()]
            out = {
                'original_filename': name,
                'raw_lines_count': len(lines),
                'raw_lines': lines,
            }
            clean_name = f"raw_{name}.json" if not name.endswith('.json') else name
            with (clean_dir / clean_name).open('w') as f:
                json.dump(out, f, indent=2)
            print(f"Cleaned unknown file to JSON: {clean_dir / clean_name}")
        except Exception as e:
            print(f"Failed to produce JSON for {name}: {e}")


def main():
    parser = argparse.ArgumentParser(description='Clean raw ffuf/subdomain JSON into structured, easier-to-use files')
    parser.add_argument('--file', '-f', help='Specific raw results file to clean (path relative to project or absolute)')
    parser.add_argument('--all', '-a', action='store_true', help='Clean all recognized raw files in results/')
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent
    results_dir = project_root / 'results'
    clean_dir = results_dir / 'clean'
    clean_dir.mkdir(parents=True, exist_ok=True)

    if args.file:
        raw = Path(args.file)
        if not raw.exists():
            # try relative to results/
            raw = results_dir / args.file
            if not raw.exists():
                print(f"File not found: {args.file}")
                return
        detect_and_clean_one(raw, clean_dir)
        return

    if args.all:
        for fname in results_dir.iterdir():
            if not fname.is_file():
                continue
            detect_and_clean_one(fname, clean_dir)
        return

    # default: clean all recognized files
    for fname in results_dir.iterdir():
        if not fname.is_file():
            continue
        detect_and_clean_one(fname, clean_dir)


if __name__ == '__main__':
    main()