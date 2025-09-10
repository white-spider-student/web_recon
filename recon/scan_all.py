#!/usr/bin/env python3
# Enhanced Web Reconnaissance Tool with SQLite-friendly output
import os
import json
import time
import sys
import uuid
import argparse
from datetime import datetime
from typing import Dict, List, Any

# Import scanner modules
import ffuf_subs
import ffuf
import nmap_http
import whatweb
import webanalyze

class WebRecon:
    def __init__(self, target: str, output_dir: str = None):
        self.target = target
        self.scan_id = str(uuid.uuid4())
        self.base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.output_dir = output_dir or os.path.join(self.base_dir, "results")
        self.timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        
        # Ensure output directory exists
        os.makedirs(self.output_dir, exist_ok=True)
        
        # Initialize results structure
        self.results = {
            "scan_info": {
                "scan_id": self.scan_id,
                "target": target,
                "timestamp_start": self.timestamp,
                "timestamp_end": None,
                "duration": 0,
                "status": "running",
                "risk_level": "unknown"
            },
            "subdomains": [],
            "directories": [],
            "vulnerabilities": [],
            "technologies": [],
            "http_services": [],
            "interesting_files": []
        }

    def run_subdomain_scan(self) -> None:
        """Run subdomain enumeration"""
        print(f"\n[+] Starting subdomain enumeration for {self.target}")
        try:
            results = ffuf_subs.run(self.target)
            if results:
                try:
                    parsed_results = json.loads(results)
                    if isinstance(parsed_results, dict):
                        for subdomain in parsed_results.get("subdomains", []):
                            if isinstance(subdomain, dict):
                                self.results["subdomains"].append({
                                    "scan_id": self.scan_id,
                                    "subdomain": subdomain.get("subdomain", ""),
                                    "status_code": subdomain.get("status_code", 0),
                                    "ip_address": subdomain.get("ip", ""),
                                    "is_active": True,
                                    "discovered_at": self.timestamp
                                })
                except json.JSONDecodeError as je:
                    print(f"[-] Error parsing subdomain results: {je}")
                    return
                print(f"[+] Found {len(self.results['subdomains'])} subdomains")
        except Exception as e:
            print(f"[-] Error in subdomain scan: {e}")

    def run_directory_scan(self) -> None:
        """Run directory enumeration"""
        print(f"\n[+] Starting directory enumeration on {self.target}")
        try:
            results = json.loads(ffuf.run(f"http://{self.target}"))
            if results and isinstance(results, dict):
                for dir_entry in results.get("findings", []):
                    self.results["directories"].append({
                        "scan_id": self.scan_id,
                        "path": dir_entry.get("url", ""),
                        "status_code": dir_entry.get("status", 0),
                        "content_length": dir_entry.get("length", 0),
                        "content_type": dir_entry.get("content-type", ""),
                        "discovered_at": self.timestamp
                    })
                    
                    # Check for interesting files
                    if self.is_interesting_file(dir_entry.get("url", "")):
                        self.results["interesting_files"].append({
                            "scan_id": self.scan_id,
                            "path": dir_entry.get("url", ""),
                            "type": "sensitive_file",
                            "reason": "Potentially sensitive file pattern",
                            "discovered_at": self.timestamp
                        })
                
                print(f"[+] Found {len(self.results['directories'])} directories/files")
        except Exception as e:
            print(f"[-] Error in directory scan: {e}")

    def run_service_scan(self) -> None:
        """Run HTTP service scanning"""
        print(f"\n[+] Starting HTTP service scan on {self.target}")
        try:
            results = nmap_http.run(self.target)
            if isinstance(results, dict):
                # Parse ports and services
                for port_info in results.get("ports", []):
                    service_info = {
                        "scan_id": self.scan_id,
                        "port": port_info.get("portid", 0),
                        "service": port_info.get("service", {}).get("name", ""),
                        "version": port_info.get("service", {}).get("version", ""),
                        "ssl_enabled": port_info.get("service", {}).get("tunnel") == "ssl",
                        "headers": json.dumps(port_info.get("script", {}).get("http-headers", {})),
                        "discovered_at": self.timestamp
                    }
                    self.results["http_services"].append(service_info)
                    
                    # Check for vulnerabilities from scripts
                    if "script" in port_info:
                        for script_id, output in port_info["script"].items():
                            if any(x in script_id.lower() for x in ["vuln", "exploit", "weakness"]):
                                self.results["vulnerabilities"].append({
                                    "scan_id": self.scan_id,
                                    "name": script_id,
                                    "severity": "medium",  # Default severity
                                    "description": output,
                                    "url": f"{self.target}:{port_info.get('portid', '')}",
                                    "discovered_at": self.timestamp
                                })
                print(f"[+] Service scan completed")
        except Exception as e:
            print(f"[-] Error in service scan: {e}")

    def run_technology_scan(self) -> None:
        """Run web technology analysis"""
        print(f"\n[+] Starting technology detection on {self.target}")
        try:
            # Run both scanners for better coverage
            all_techs = []
            
            # Ensure proper URL formatting
            target_url = self.target
            if not target_url.startswith('http://') and not target_url.startswith('https://'):
                target_url = f"http://{target_url}"
            
            # Run webanalyze
            webanalyze_results = webanalyze.run(target_url)
            if isinstance(webanalyze_results, list):
                all_techs.extend(webanalyze_results)
            
            # Run whatweb
            whatweb_results = whatweb.run(target_url)
            if isinstance(whatweb_results, list):
                all_techs.extend(whatweb_results)
            # Process and store results
            for tech in all_techs:
                self.results["technologies"].append({
                    "scan_id": self.scan_id,
                    "name": tech.get("name", ""),
                    "version": tech.get("version", "unknown"),
                    "category": tech.get("category", ""),
                    "website": tech.get("website", ""),
                    "discovered_at": self.timestamp
                })
            
            print(f"[+] Found {len(self.results['technologies'])} technologies")
        except Exception as e:
            print(f"[-] Error in technology scan: {e}")

    def is_interesting_file(self, path: str) -> bool:
        """Check if a file path is potentially interesting/sensitive"""
        sensitive_patterns = [
            '.env', '.git', '.svn', '.bak', '.backup', '.swp', '.old',
            'admin', 'config', '.conf', '.cfg', '.ini', '.db', '.sql',
            'phpinfo', '.htpasswd', '.htaccess'
        ]
        return any(pattern in path.lower() for pattern in sensitive_patterns)

    def analyze_risk_level(self) -> None:
        """Analyze findings and determine risk level"""
        risk_score = 0
        
        # Check for sensitive files
        risk_score += len(self.results["interesting_files"]) * 2
        
        # Check exposed services
        risk_score += len([s for s in self.results["http_services"] 
                          if s["port"] not in [80, 443]]) * 1
        
        # Set risk level
        if risk_score > 10:
            self.results["scan_info"]["risk_level"] = "Critical"
        elif risk_score > 5:
            self.results["scan_info"]["risk_level"] = "High"
        elif risk_score > 2:
            self.results["scan_info"]["risk_level"] = "Medium"
        else:
            self.results["scan_info"]["risk_level"] = "Low"

    def save_results(self) -> str:
        """Save scan results to JSON file"""
        output_file = os.path.join(
            self.output_dir,
            f"scan_{self.target.replace('.', '_')}_{self.timestamp}.json"
        )
        
        with open(output_file, 'w') as f:
            json.dump(self.results, f, indent=2)
        
        return output_file

    def print_summary(self) -> None:
        """Print scan summary"""
        print("\n" + "="*50)
        print(f"Scan Summary for {self.target}")
        print("="*50)
        print(f"Scan ID: {self.scan_id}")
        print(f"Start Time: {self.results['scan_info']['timestamp_start']}")
        print(f"End Time: {self.results['scan_info']['timestamp_end']}")
        print(f"Duration: {self.results['scan_info']['duration']:.2f} seconds")
        print("\nFindings:")
        print(f"- Subdomains: {len(self.results['subdomains'])}")
        print(f"- Directories/Files: {len(self.results['directories'])}")
        print(f"- Technologies: {len(self.results['technologies'])}")
        print(f"- HTTP Services: {len(self.results['http_services'])}")
        print(f"- Interesting Files: {len(self.results['interesting_files'])}")
        print(f"\nRisk Level: {self.results['scan_info']['risk_level']}")

    def run_all_scans(self) -> Dict:
        """Run all scans in sequence"""
        start_time = time.time()
        
        try:
            self.run_subdomain_scan()
            self.run_directory_scan()
            self.run_service_scan()
            self.run_technology_scan()
            
            # Update scan completion details
            self.results["scan_info"]["timestamp_end"] = datetime.now().strftime("%Y%m%d-%H%M%S")
            self.results["scan_info"]["duration"] = time.time() - start_time
            self.results["scan_info"]["status"] = "completed"
            
            # Analyze risk level
            self.analyze_risk_level()
            
            # Save and print results
            output_file = self.save_results()
            self.print_summary()
            
            print(f"\nDetailed results saved to: {output_file}")
            return self.results
            
        except KeyboardInterrupt:
            print("\n[!] Scan interrupted by user")
            self.results["scan_info"]["status"] = "interrupted"
            return self.results
        except Exception as e:
            print(f"\n[!] Error during scan: {e}")
            self.results["scan_info"]["status"] = "error"
            return self.results

def main():
    parser = argparse.ArgumentParser(description="Comprehensive Web Reconnaissance Tool")
    parser.add_argument("target", help="Target domain to scan")
    parser.add_argument("--output", help="Custom output directory")
    args = parser.parse_args()
    
    scanner = WebRecon(target=args.target, output_dir=args.output)
    scanner.run_all_scans()

if __name__ == "__main__":
    main()
