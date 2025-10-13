import os
import subprocess
import json

def run_ffuf(domain):
    """Run ffuf_subs.py to discover subdomains."""
    result = subprocess.run(
        ["python3", "ffuf_subs.py", domain],
        capture_output=True,
        text=True
    )
    return json.loads(result.stdout)

def run_dirsearch(subdomain):
    """Run dirsearch.py on the given subdomain."""
    result = subprocess.run(
        ["python3", "dirsearch.py", "-u", f"http://{subdomain}"],
        capture_output=True,
        text=True
    )
    return result.stdout

def run_nmap(domain):
    """Run nmap.py on the given domain."""
    result = subprocess.run(
        ["python3", "nmap.py", domain],
        capture_output=True,
        text=True
    )
    return result.stdout

def run_whatweb(subdomain):
    """Run whatweb.py on the given subdomain."""
    result = subprocess.run(
        ["python3", "whatweb.py", f"http://{subdomain}"],
        capture_output=True,
        text=True
    )
    return result.stdout

def run_webanalyze(subdomain):
    """Run webanalyze.py on the given subdomain."""
    result = subprocess.run(
        ["python3", "webanalyze.py", f"http://{subdomain}"],
        capture_output=True,
        text=True
    )
    return result.stdout

def main(domain):
    results_dir = os.path.join(os.path.dirname(__file__), "results")
    
    # Step 1: Discover subdomains
    subdomains = run_ffuf(domain)
    
    # Step 2: Run dirsearch on each discovered subdomain
    for subdomain in subdomains.get('subdomains', []):
        dirsearch_results = run_dirsearch(subdomain)
        with open(os.path.join(results_dir, f"{subdomain}_dirsearch.txt"), 'w') as f:
            f.write(dirsearch_results)
    
    # Step 3: Run nmap on the root domain
    nmap_results = run_nmap(domain)
    with open(os.path.join(results_dir, f"{domain}_nmap.txt"), 'w') as f:
        f.write(nmap_results)
    
    # Step 4: Run whatweb and webanalyze on each discovered subdomain
    for subdomain in subdomains.get('subdomains', []):
        whatweb_results = run_whatweb(subdomain)
        with open(os.path.join(results_dir, f"{subdomain}_whatweb.txt"), 'w') as f:
            f.write(whatweb_results)
        
        webanalyze_results = run_webanalyze(subdomain)
        with open(os.path.join(results_dir, f"{subdomain}_webanalyze.txt"), 'w') as f:
            f.write(webanalyze_results)

if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        print("Usage: python3 run_all.py <domain>")
        sys.exit(1)
    main(sys.argv[1])