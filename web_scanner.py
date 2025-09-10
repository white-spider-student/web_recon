#!/usr/bin/env python3
"""
Complete Web Scanner

This script performs a complete web scanning process:
1. Discovers subdomains using ffuf_subs
2. Scans directories for each subdomain using ffuf
3. Displays and saves comprehensive results
"""

import os
import sys
import json
import argparse
import time
from datetime import datetime
from urllib.parse import urlparse

def discover_subdomains(domain, max_time=120):
    """
    Discover subdomains for a given domain
    """
    print(f"[+] Discovering subdomains for {domain} (timeout: {max_time}s)")
    
    # Setup paths
    base_dir = os.path.dirname(os.path.abspath(__file__))
    results_dir = os.path.join(base_dir, "results")
    os.makedirs(results_dir, exist_ok=True)
    
    # Import ffuf_subs module
    sys.path.append(os.path.join(base_dir, "recon"))
    try:
        from recon.ffuf_subs import run as run_ffuf_subs
    except ImportError:
        print(f"[!] Error importing ffuf_subs module")
        return None
    
    # Run the scan
    try:
        result_json = run_ffuf_subs(domain, max_time)
        result = json.loads(result_json)
        result_file = os.path.join(results_dir, f"ffuf_subs_{domain}_{int(time.time())}.json")
        
        # Save the raw result
        with open(result_file, 'w') as f:
            json.dump(result, f, indent=2)
        
        print(f"[+] Saved raw subdomain results to {result_file}")
        return result
    except Exception as e:
        print(f"[!] Error discovering subdomains: {e}")
        return None

def extract_domains(subdomains_result, main_domain):
    """
    Extract all domains from subdomain scan results
    """
    domains = [main_domain]  # Always include the main domain
    
    if not subdomains_result:
        print("[!] No subdomain results to process")
        return domains
    
    # Try different formats based on ffuf_subs output structure
    if "findings" in subdomains_result:
        findings = subdomains_result["findings"]
    elif "results" in subdomains_result:
        findings = subdomains_result["results"]
    else:
        print("[!] Could not find 'findings' or 'results' key in subdomain results")
        return domains
    
    for finding in findings:
        subdomain = None
        
        # Try to get subdomain from different fields
        if "subdomain" in finding:
            subdomain = finding["subdomain"]
        elif "host" in finding:
            subdomain = finding["host"]
        elif "url" in finding:
            url = finding["url"]
            if "://" in url:
                url_parts = url.split("://", 1)[1]
                subdomain = url_parts.split("/", 1)[0]
        
        # Add subdomain if found and not already in the list
        if subdomain and subdomain not in domains:
            # Check if it's already a full domain or just a subdomain part
            if not subdomain.endswith(main_domain) and "." not in subdomain:
                full_domain = f"{subdomain}.{main_domain}"
            else:
                full_domain = subdomain
            
            if full_domain not in domains:
                domains.append(full_domain)
                print(f"[+] Found subdomain: {full_domain}")
    
    return domains

def scan_domain_directories(domain, max_time=60, protocol="both"):
    """
    Scan a domain for directories and files
    """
    print(f"[+] Scanning {domain} for directories (timeout: {max_time}s)")
    
    # Setup paths
    base_dir = os.path.dirname(os.path.abspath(__file__))
    results_dir = os.path.join(base_dir, "results")
    os.makedirs(results_dir, exist_ok=True)
    
    # Import ffuf module
    sys.path.append(os.path.join(base_dir, "recon"))
    try:
        from recon.ffuf import run as run_ffuf
    except ImportError:
        print(f"[!] Error importing ffuf module")
        return None
    
    # Scan HTTP, HTTPS, or both
    results = {}
    
    if protocol in ["http", "both"]:
        print(f"\n[+] Scanning HTTP: http://{domain}/")
        try:
            http_url = f"http://{domain}"
            http_result_json = run_ffuf(http_url, max_time)
            results["http"] = json.loads(http_result_json)
            
            # Save raw HTTP results
            http_result_file = os.path.join(results_dir, f"ffuf_dirs_http_{domain}_{int(time.time())}.json")
            with open(http_result_file, 'w') as f:
                json.dump(results["http"], f, indent=2)
            
            print(f"[+] HTTP scan complete: found {len(results['http'].get('findings', []))} items")
            print(f"[+] Saved raw HTTP results to {http_result_file}")
            
        except Exception as e:
            print(f"[!] Error scanning HTTP: {e}")
            results["http"] = {"error": str(e), "findings": []}
    
    if protocol in ["https", "both"]:
        print(f"\n[+] Scanning HTTPS: https://{domain}/")
        try:
            https_url = f"https://{domain}"
            https_result_json = run_ffuf(https_url, max_time)
            results["https"] = json.loads(https_result_json)
            
            # Save raw HTTPS results
            https_result_file = os.path.join(results_dir, f"ffuf_dirs_https_{domain}_{int(time.time())}.json")
            with open(https_result_file, 'w') as f:
                json.dump(results["https"], f, indent=2)
            
            print(f"[+] HTTPS scan complete: found {len(results['https'].get('findings', []))} items")
            print(f"[+] Saved raw HTTPS results to {https_result_file}")
            
        except Exception as e:
            print(f"[!] Error scanning HTTPS: {e}")
            results["https"] = {"error": str(e), "findings": []}
    
    return results

def extract_directories_and_files(results):
    """
    Extract directories and files from scan results
    """
    directories = []
    files = []
    
    # Process results for each protocol
    for protocol in ["http", "https"]:
        if protocol not in results or "findings" not in results[protocol]:
            continue
            
        for finding in results[protocol]["findings"]:
            path = finding.get("path", "")
            url = finding.get("url", "")
            status = finding.get("status", 0)
            content_length = finding.get("length", 0)
            
            # Check if it's a directory using multiple methods
            is_directory = False
            
            # Method 1: Path ends with /
            if path.endswith('/'):
                is_directory = True
            
            # Method 2: No file extension in last path component
            elif '.' not in path.split('/')[-1]:
                is_directory = True
            
            # Method 3: Redirect status with location ending in /
            elif status in [301, 302, 307, 308]:
                redirect_location = finding.get("redirectlocation", "")
                if redirect_location and redirect_location.endswith('/'):
                    is_directory = True
            
            # Add to appropriate list
            if is_directory:
                directories.append({
                    "url": url,
                    "path": path,
                    "status": status,
                    "length": content_length,
                    "protocol": protocol
                })
            else:
                files.append({
                    "url": url,
                    "path": path,
                    "status": status,
                    "length": content_length,
                    "protocol": protocol
                })
    
    return {
        "directories": directories,
        "files": files
    }

def run_web_scan(args):
    """
    Run the complete web scanning workflow
    """
    # Set up results structure
    scan_results = {
        "scan_info": {
            "main_domain": args.domain,
            "protocol": args.protocol,
            "subdomain_max_time": args.subdomain_time,
            "directory_max_time": args.dir_time,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "start_time": time.time()
        },
        "domains": {},
        "summary": {
            "total_domains": 0,
            "total_directories": 0,
            "total_files": 0
        }
    }
    
    # Step 1: Discover Subdomains
    print("\n[1] SUBDOMAIN DISCOVERY PHASE")
    print("=" * 80)
    start_time = time.time()
    
    domains = []
    if args.skip_subdomain_discovery:
        print("[*] Skipping subdomain discovery as requested")
        domains = [args.domain]  # Use only the main domain
    else:
        subdomains_result = discover_subdomains(args.domain, args.subdomain_time)
        subdomain_time = time.time() - start_time
        print(f"[+] Subdomain discovery completed in {subdomain_time:.2f} seconds")
        
        # Extract domains from results
        domains = extract_domains(subdomains_result, args.domain)
    
    # Add manual subdomains if provided
    if args.manual_subdomains:
        manual_domains = [d.strip() for d in args.manual_subdomains.split(',')]
        for d in manual_domains:
            if d not in domains:
                full_domain = d
                if not d.endswith(args.domain) and "." not in d:
                    full_domain = f"{d}.{args.domain}"
                domains.append(full_domain)
                print(f"[+] Added manual subdomain: {full_domain}")
    
    # Skip main domain if requested
    if args.skip_main and args.domain in domains:
        domains.remove(args.domain)
        print(f"[+] Skipping main domain as requested: {args.domain}")
    
    # Save the list of domains
    print(f"[+] Total domains to scan: {len(domains)}")
    scan_results["domains_list"] = domains
    
    # Step 2: Scan each domain for directories
    print("\n[2] DIRECTORY SCANNING PHASE")
    print("=" * 80)
    
    for i, domain in enumerate(domains, 1):
        print(f"\n[{i}/{len(domains)}] Scanning directories for: {domain}")
        domain_start_time = time.time()
        
        # Scan the domain
        dir_results = scan_domain_directories(domain, args.dir_time, args.protocol)
        
        if not dir_results:
            print(f"[!] No results for {domain}")
            scan_results["domains"][domain] = {
                "error": "No results",
                "scan_time": time.time() - domain_start_time
            }
            continue
        
        # Process results
        processed_results = extract_directories_and_files(dir_results)
        directories = processed_results["directories"]
        files = processed_results["files"]
        
        # Save domain results
        scan_results["domains"][domain] = {
            "directories": directories,
            "files": files,
            "scan_time": time.time() - domain_start_time,
            "summary": {
                "directories_count": len(directories),
                "files_count": len(files)
            }
        }
        
        # Update summary
        scan_results["summary"]["total_directories"] += len(directories)
        scan_results["summary"]["total_files"] += len(files)
        
        # Print summary for this domain
        print(f"  > Found {len(directories)} directories and {len(files)} files")
        print(f"  > Scan completed in {time.time() - domain_start_time:.2f} seconds")
    
    # Update final stats
    scan_results["summary"]["total_domains"] = len(domains)
    scan_results["scan_info"]["end_time"] = time.time()
    scan_results["scan_info"]["total_duration"] = scan_results["scan_info"]["end_time"] - scan_results["scan_info"]["start_time"]
    
    return scan_results

def main():
    parser = argparse.ArgumentParser(description="Complete Web Scanner")
    parser.add_argument("domain", help="Main domain to scan (e.g., example.com)")
    parser.add_argument("--subdomain-time", type=int, default=120, 
                        help="Maximum time for subdomain discovery in seconds (default: 120)")
    parser.add_argument("--dir-time", type=int, default=60, 
                        help="Maximum time for directory scanning per domain in seconds (default: 60)")
    parser.add_argument("--protocol", choices=["http", "https", "both"], default="both", 
                        help="Protocol to scan (http, https, or both)")
    parser.add_argument("--skip-main", action="store_true", 
                        help="Skip scanning the main domain")
    parser.add_argument("--skip-subdomain-discovery", action="store_true",
                        help="Skip subdomain discovery and scan only the main domain")
    parser.add_argument("--manual-subdomains", 
                        help="Comma-separated list of additional subdomains to scan")
    parser.add_argument("--output", help="Output file for results (default: <domain>_scan_<timestamp>.json)")
    args = parser.parse_args()
    
    # Print banner
    print(f"""
╔═══════════════════════════════════════════════════╗
║              COMPLETE WEB SCANNER                 ║
╚═══════════════════════════════════════════════════╝

Target: {args.domain}
Protocol: {args.protocol}
Subdomain Max Time: {args.subdomain_time} seconds
Directory Scan Max Time: {args.dir_time} seconds per domain
Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
    """)
    
    # Run the scan
    scan_results = run_web_scan(args)
    
    # Print final summary
    print("\n[3] SCAN SUMMARY")
    print("=" * 80)
    print(f"Total domains scanned: {scan_results['summary']['total_domains']}")
    print(f"Total directories found: {scan_results['summary']['total_directories']}")
    print(f"Total files found: {scan_results['summary']['total_files']}")
    print(f"Total scan time: {scan_results['scan_info']['total_duration']:.2f} seconds")
    
    # Save results
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output_file = args.output or f"{args.domain}_scan_{timestamp}.json"
    
    with open(output_file, 'w') as f:
        json.dump(scan_results, f, indent=2)
    
    print(f"\n[+] Results saved to: {output_file}")
    
    # Print detailed results for each domain
    print("\n[4] DETAILED RESULTS")
    print("=" * 80)
    
    for domain, domain_results in scan_results["domains"].items():
        print(f"\nDomain: {domain}")
        print("-" * 60)
        
        if "directories" in domain_results:
            print(f"Directories ({len(domain_results['directories'])}):")
            for dir_info in domain_results["directories"][:10]:  # Show first 10
                print(f"  - [{dir_info['protocol'].upper()}] {dir_info['path']} (Status: {dir_info['status']})")
            if len(domain_results["directories"]) > 10:
                print(f"  ... and {len(domain_results['directories']) - 10} more")
        
        if "files" in domain_results:
            print(f"Files ({len(domain_results['files'])}):")
            for file_info in domain_results["files"][:10]:  # Show first 10
                print(f"  - [{file_info['protocol'].upper()}] {file_info['path']} (Status: {file_info['status']})")
            if len(domain_results["files"]) > 10:
                print(f"  ... and {len(domain_results['files']) - 10} more")

if __name__ == "__main__":
    main()
