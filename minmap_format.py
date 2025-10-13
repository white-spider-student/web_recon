import os
import json
import glob

# Use cleaned results directory (relative to project)
clean_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "clean")

def load_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None

# Find cleaned subdomains file
subs_files = glob.glob(os.path.join(clean_dir, "subs_*.json"))
if not subs_files:
    print("No cleaned subdomains file found.")
    main_domain = None
    subdomains = []
else:
    subs_file = subs_files[0]
    subs_data = load_json(subs_file) or {}
    subdomains = subs_data.get('subdomains', [])
    # derive main domain from filename pattern subs_{domain}.json
    main_domain = os.path.basename(subs_file).split('subs_')[1].rsplit('.json', 1)[0]
    subdomains = [s for s in subdomains if s != main_domain]

nodes = []
relationships = []

if main_domain:
    # prepare list of hosts to include: main + subs
    hosts = [main_domain] + subdomains
    for host in hosts:
        node_type = "domain" if host == main_domain else "subdomain"
        node = {"value": host, "type": node_type, "label": host}
        # look for a concise summary file produced by clean_from_raw
        summary_path = os.path.join(clean_dir, f"summary_{host}.json")
        summary = load_json(summary_path)
        if not summary:
            # fallback to full simple_fingerprint file
            fp_path = os.path.join(clean_dir, f"simple_fingerprint_{host}.json")
            fp = load_json(fp_path) or {}
            summary = fp.get('primary_probe') if isinstance(fp.get('primary_probe'), dict) else None

        meta = {}
        if isinstance(summary, dict):
            meta['status'] = summary.get('status') or summary.get('status_code') or 0
            meta['size'] = summary.get('content_length') or summary.get('content_length') or 0
            meta['ip'] = summary.get('ip') or summary.get('resolved_ip')
            meta['response_time_ms'] = summary.get('response_time_ms')
            # headers may be a dict; normalize keys/values to strings
            raw_headers = summary.get('headers') or {}
            if isinstance(raw_headers, dict):
                norm = {}
                for hk, hv in raw_headers.items():
                    try:
                        norm[str(hk)] = str(hv)
                    except Exception:
                        norm[str(hk)] = hv
                meta['headers'] = norm
            else:
                meta['headers'] = raw_headers or {}
            meta['title'] = summary.get('title')
            meta['technologies'] = summary.get('technologies') if 'technologies' in summary else summary.get('tech') or []
            meta['wappalyzer'] = summary.get('wappalyzer')
            # TLS cert summary if present
            if summary.get('tls_cert'):
                tls = summary.get('tls_cert')
                if isinstance(tls, dict):
                    meta['tls_cert'] = {
                        'common_name': tls.get('common_name') or (tls.get('subject') or {}).get('commonName') if isinstance(tls.get('subject'), dict) else tls.get('common_name'),
                        'valid_from': tls.get('valid_from') or tls.get('not_valid_before'),
                        'valid_to': tls.get('valid_to') or tls.get('not_valid_after')
                    }

        # enrich with nmap ports if available (cleaned nmap JSON files)
        nmap_files = glob.glob(os.path.join(clean_dir, f"nmap*{host}*.json"))
        ports = []
        for nf in nmap_files:
            nj = load_json(nf)
            if isinstance(nj, dict) and 'hosts' in nj:
                for h in nj['hosts']:
                    for p in h.get('ports', []):
                        try:
                            ports.append(int(p.get('port')))
                        except Exception:
                            pass
        if ports:
            meta['ports'] = sorted(set(ports))

        # include dirsearch summary counts if present
        dir_json = os.path.join(clean_dir, f"dirsearch_{host}.json")
        if os.path.exists(dir_json):
            dj = load_json(dir_json) or {}
            count = dj.get('summary_count') or len(dj.get('findings', [])) if isinstance(dj, dict) else 0
            meta['dirsearch_count'] = count

        # push frontend-friendly top-level keys while keeping the enriched metadata under 'meta'
        node['id'] = host
        node['group'] = node_type
        node['value'] = host
        node['type'] = node_type
        node['status'] = meta.get('status', 0)
        node['size'] = meta.get('size', 0)
        node['meta'] = meta
        # Provide frontend-friendly headers array in addition to meta.headers
        if isinstance(meta.get('headers'), dict):
            node['headers'] = [{ 'key': k, 'value': v } for k, v in meta['headers'].items()]
        elif isinstance(meta.get('headers'), list):
            node['headers'] = meta['headers']
        else:
            node['headers'] = []

        nodes.append(node)
        # relationships: main contains subs
        if host != main_domain:
            relationships.append({"source": main_domain, "target": host, "type": "contains"})

    # after processing all hosts, write viz JSON
    viz_json = {
        "website": {"url": main_domain, "name": main_domain},
        "nodes": nodes,
        "relationships": relationships
    }
    output_file = os.path.join(clean_dir, f"{main_domain}_viz.json")
    with open(output_file, 'w') as f:
        json.dump(viz_json, f, indent=2)
    print(f"Visualization JSON saved to {output_file}")
else:
    print("No visualization JSON generated.")
