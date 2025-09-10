#!/usr/bin/env python3
"""
Comprehensive Scanner

This script automates the web reconnaissance process by:
1. Running subdomain enumeration
2. Automatically scanning each discovered subdomain for directories
3. Running service and technology detection on all targets
4. Formatting the results into a unified JSON structure for SQLite import
"""

import os
import sys
import json
import time
import argparse
import subprocess
from typing import List, Dict, Any
from urllib.parse import urlparse

# Import scanner modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import ffuf_subs
import ffuf
import nmap_http
import webanalyze
import whatweb
import format_results

class ComprehensiveScanner:
    def __init__(self, target: str, output_dir: str = None, max_depth: int = 1, timeout: int = 30):
        self.target = target
        self.base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.output_dir = output_dir or os.path.join(self.base_dir, "results")
        self.max_depth = max_depth  # Maximum subdomain depth to scan
        self.timeout = timeout  # Maximum time per scan in seconds
        
        # Ensure output directory exists
        os.makedirs(self.output_dir, exist_ok=True)
        
        # Track which targets have been scanned for directories
        self.dir_scanned_targets = set()
        
        # Final collected results
        self.scan_results = {
            "subdomains": [],
            "directories": [],
            "technologies": [],
            "services": []
        }
        
        print(f"[+] Starting comprehensive scan of {target}")
        print(f"[+] Results will be saved to {self.output_dir}")
        print(f"[+] Maximum subdomain depth: {max_depth}")
        print(f"[+] Timeout per scan: {timeout} seconds")
    
    def normalize_domain(self, domain: str) -> str:
        """Normalize domain name by removing protocol and trailing slashes"""
        domain = domain.lower()
        domain = domain.replace("http://", "").replace("https://", "")
        domain = domain.split("/")[0]  # Remove any path
        domain = domain.split(":")[0]  # Remove any port
        return domain
    
    def extract_subdomains_from_result(self, result_data: Dict) -> List[str]:
        """Extract subdomains from scan result data"""
        subdomains = []
        
        # Check standard format
        if "subdomains" in result_data:
            for entry in result_data["subdomains"]:
                if "subdomain" in entry:
                    subdomains.append(entry["subdomain"])
        
        # Check alternative format with "results" field
        if "results" in result_data:
            for entry in result_data["results"]:
                if "host" in entry:
                    subdomains.append(entry["host"])
                elif "url" in entry:
                    parsed_url = urlparse(entry["url"])
                    if parsed_url.netloc:
                        subdomains.append(parsed_url.netloc)
        
        return subdomains
    
    def run_subdomain_scan(self) -> List[str]:
        """Run subdomain enumeration and return discovered subdomains"""
        print(f"\n[+] Starting subdomain enumeration for {self.target}")
        
        discovered_subdomains = []
        try:
            # Run ffuf_subs scanner
            result_json = ffuf_subs.run(self.target)
            if result_json:
                try:
                    result_data = json.loads(result_json)
                    discovered_subdomains = self.extract_subdomains_from_result(result_data)
                    print(f"[+] Found {len(discovered_subdomains)} subdomains")
                except json.JSONDecodeError:
                    print(f"[-] Error parsing subdomain results")
        except Exception as e:
            print(f"[-] Error in subdomain scan: {e}")
        
        # Store in results
        self.scan_results["subdomains"] = discovered_subdomains
        
        return discovered_subdomains
    
    def run_directory_scan(self, target: str) -> None:
        """Run directory enumeration on a target"""
        normalized_target = self.normalize_domain(target)
        
        # Skip if already scanned
        if normalized_target in self.dir_scanned_targets:
            print(f"[*] Skipping directory scan for {target} (already scanned)")
            return
        
        print(f"\n[+] Starting directory enumeration on {target}")
        
        # Mark as scanned
        self.dir_scanned_targets.add(normalized_target)
        
        try:
            # Ensure target has protocol
            if not target.startswith("http://") and not target.startswith("https://"):
                target = f"http://{target}"
            
            # Run ffuf scanner
            ffuf.run(target, max_time=self.timeout)
            print(f"[+] Directory scan completed for {target}")
        except Exception as e:
            print(f"[-] Error in directory scan for {target}: {e}")
    
    def run_service_scan(self, target: str) -> None:
        """Run HTTP service scanning on a target"""
        print(f"\n[+] Starting HTTP service scan on {target}")
        
        try:
            # Run nmap_http scanner
            nmap_http.run(target, max_time=self.timeout*2)  # Give nmap more time
            print(f"[+] Service scan completed for {target}")
        except Exception as e:
            print(f"[-] Error in service scan for {target}: {e}")
    
    def run_technology_scan(self, target: str) -> None:
        """Run web technology analysis on a target"""
        print(f"\n[+] Starting technology detection on {target}")
        
        try:
            # Ensure target has protocol
            if not target.startswith("http://") and not target.startswith("https://"):
                target = f"http://{target}"
            
            # Run both technology scanners
            whatweb.run(target, max_time=self.timeout)
            webanalyze.run(target, max_time=self.timeout)
            print(f"[+] Technology scan completed for {target}")
        except Exception as e:
            print(f"[-] Error in technology scan for {target}: {e}")
    
    def scan_target_recursive(self, target: str, current_depth: int = 0) -> None:
        """Recursively scan a target and its subdomains"""
        if current_depth > self.max_depth:
            return
        
        # Run service and technology scans on current target
        self.run_service_scan(target)
        self.run_technology_scan(target)
        
        # Run directory scan on current target
        self.run_directory_scan(target)
        
        # If we haven't reached max depth, scan for subdomains
        if current_depth < self.max_depth:
            # Only run subdomain scan if target is a domain, not an IP
            if not self.is_ip_address(target):
                subdomains = self.run_subdomain_scan()
                
                # Recursively scan each subdomain
                for subdomain in subdomains:
                    print(f"\n[+] Recursively scanning subdomain: {subdomain}")
                    self.scan_target_recursive(subdomain, current_depth + 1)
    
    def is_ip_address(self, target: str) -> bool:
        """Check if target is an IP address"""
        target = self.normalize_domain(target)
        import re
        ip_pattern = r'^(\d{1,3}\.){3}\d{1,3}$'
        return bool(re.match(ip_pattern, target))
    
    def format_results(self) -> str:
        """Run the formatter on all results"""
        print("\n[+] Formatting scan results...")
        
        # Run the formatter
        formatter = format_results.ScanFormatter(self.output_dir)
        formatter.process_results()
        output_file = formatter.save_output()
        
        return output_file
    
    def run_scan(self) -> str:
        """Run the complete scanning process"""
        start_time = time.time()
        
        try:
            # Start with the main target
            self.scan_target_recursive(self.target)
            
            # Format the results
            output_file = self.format_results()
            
            # Print summary
            duration = time.time() - start_time
            print(f"\n[+] Scan completed in {duration:.2f} seconds")
            print(f"[+] Results formatted and saved to: {output_file}")
            
            return output_file
            
        except KeyboardInterrupt:
            print("\n[!] Scan interrupted by user")
            self.format_results()
            return "Scan interrupted"
        except Exception as e:
            print(f"\n[!] Error during scan: {e}")
            return "Scan error"

def main():
    parser = argparse.ArgumentParser(description="Comprehensive Web Reconnaissance Tool")
    parser.add_argument("target", help="Target domain to scan")
    parser.add_argument("--output", help="Custom output directory")
    parser.add_argument("--depth", type=int, default=1, help="Maximum subdomain recursion depth")
    parser.add_argument("--timeout", type=int, default=30, help="Timeout per scan in seconds")
    
    args = parser.parse_args()
    
    scanner = ComprehensiveScanner(
        target=args.target,
        output_dir=args.output,
        max_depth=args.depth,
        timeout=args.timeout
    )
    
    scanner.run_scan()

if __name__ == "__main__":
    main()
