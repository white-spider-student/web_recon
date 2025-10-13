# filepath: /web_recon/recon/run_all.py
import os
import json
import subprocess

def load_results(filename):
    with open(filename, 'r') as f:
        return json.load(f)

def run_ffuf(domain):
    print(f"[run_all] Running ffuf_subs.py for domain: {domain}")
    subprocess.run(["python3", "ffuf_subs.py", domain])

def run_dirsearch(subdomain):
    print(f"[run_all] Running dirsearch.py for subdomain: {subdomain}")
    subprocess.run(["python3", "dirsearch.py", subdomain])

def run_nmap(domain):
    print(f"[run_all] Running nmap.py for domain: {domain}")
    subprocess.run(["python3", "nmap.py", domain])

def run_whatweb(subdomain):
    print(f"[run_all] Running whatweb.py for subdomain: {subdomain}")
    subprocess.run(["python3", "whatweb.py", subdomain])

def run_webanalyze(subdomain):
    print(f"[run_all] Running webanalyze.py for subdomain: {subdomain}")
    subprocess.run(["python3", "webanalyze.py", subdomain])

def main(domain):
    results_dir = os.path.join(os.path.dirname(__file__), "results")
    ffuf_results_file = os.path.join(results_dir, f"ffuf_subs_{domain.replace('.', '_')}.json")

    run_ffuf(domain)

    if os.path.exists(ffuf_results_file):
        results = load_results(ffuf_results_file)
        subdomains = [sub['subdomain'] for sub in results.get('results', [])]

        for subdomain in subdomains:
            run_dirsearch(subdomain)
            run_whatweb(subdomain)
            run_webanalyze(subdomain)

    run_nmap(domain)

if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        print("Usage: python3 run_all.py <domain>")
        sys.exit(1)
    main(sys.argv[1])