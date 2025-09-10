#!/usr/bin/env python3
"""
Scan Results Formatter

This script combines and formats results from various scan tools in the results directory
and generates a unified JSON file ready for importing into SQLite.
"""

import os
import json
import glob
import re
import uuid
from datetime import datetime
from typing import Dict, List, Any, Optional

class ScanFormatter:
    def __init__(self, results_dir: str, output_file: str = None):
        self.results_dir = results_dir
        self.scan_id = str(uuid.uuid4())
        self.timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        
        if output_file is None:
            output_file = os.path.join(
                results_dir, 
                f"combined_scan_results_{self.timestamp}.json"
            )
        self.output_file = output_file
        
        # Initialize the unified data structure
        self.unified_data = {
            "scan_info": {
                "scan_id": self.scan_id,
                "timestamp": self.timestamp,
                "scan_sources": []
            },
            "targets": {},
            "nodes": [],
            "relationships": []
        }
        
        # Node ID counter for creating unique IDs
        self.next_node_id = 1
        
        # Map of hostnames to node IDs
        self.hostname_node_map = {}
    
    def _get_next_node_id(self) -> int:
        """Get the next available node ID"""
        node_id = self.next_node_id
        self.next_node_id += 1
        return node_id
    
    def _get_or_create_target_node(self, hostname: str, ip: Optional[str] = None) -> int:
        """Get or create a node for a target hostname"""
        if hostname in self.hostname_node_map:
            return self.hostname_node_map[hostname]
        
        # Create a new node
        node_id = self._get_next_node_id()
        self.hostname_node_map[hostname] = node_id
        
        node = {
            "id": node_id,
            "type": "host",
            "hostname": hostname,
            "ip_addresses": [ip] if ip else [],
            "first_seen": self.timestamp,
            "last_seen": self.timestamp
        }
        
        self.unified_data["nodes"].append(node)
        return node_id
    
    def _extract_hostname_from_file(self, filename: str) -> str:
        """Extract hostname from a result filename"""
        # Common patterns for hostnames in filenames
        patterns = [
            r'whatweb_([^_]+)_\d+',
            r'nmap_http_([^_]+)_\d+',
            r'ffuf_dirs_http_([^_]+)_\d+',
            r'ffuf_subs_([^_]+)_\d+',
            r'scan_([^_]+)_\d+',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, filename)
            if match:
                return match.group(1)
        
        return "unknown"
    
    def _process_whatweb_file(self, file_path: str) -> None:
        """Process a WhatWeb result file"""
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
            
            # Add source info
            self.unified_data["scan_info"]["scan_sources"].append({
                "tool": "whatweb",
                "file": os.path.basename(file_path),
                "timestamp": self._extract_timestamp_from_file(file_path)
            })
            
            if not isinstance(data, list):
                print(f"Warning: WhatWeb file {file_path} has unexpected format")
                return
            
            for entry in data:
                target = entry.get("target", "")
                hostname = self._extract_domain_from_url(target)
                ip = self._extract_ip_from_url(target) or hostname
                
                # Create or get target node
                target_node_id = self._get_or_create_target_node(hostname, ip)
                
                # Process technologies
                plugins = entry.get("plugins", {})
                for plugin_name, plugin_data in plugins.items():
                    # Skip Country and non-technology plugins
                    if plugin_name in ["Country", "HTTPServer"]:
                        continue
                    
                    tech_node_id = self._get_next_node_id()
                    
                    # Create technology node
                    tech_node = {
                        "id": tech_node_id,
                        "type": "technology",
                        "name": plugin_name,
                        "version": plugin_data.get("version", ["unknown"])[0] if isinstance(plugin_data.get("version", []), list) else "unknown",
                        "category": self._categorize_technology(plugin_name),
                        "confidence": 100
                    }
                    
                    self.unified_data["nodes"].append(tech_node)
                    
                    # Create relationship
                    self.unified_data["relationships"].append({
                        "source": target_node_id,
                        "target": tech_node_id,
                        "type": "uses",
                        "discovered_at": self.timestamp
                    })
        
        except Exception as e:
            print(f"Error processing WhatWeb file {file_path}: {e}")
    
    def _process_nmap_http_file(self, file_path: str) -> None:
        """Process an Nmap HTTP result file"""
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
            
            # Add source info
            self.unified_data["scan_info"]["scan_sources"].append({
                "tool": "nmap_http",
                "file": os.path.basename(file_path),
                "timestamp": self._extract_timestamp_from_file(file_path)
            })
            
            hosts = data.get("hosts", [])
            for host in hosts:
                ip = host.get("address")
                hostname = ip  # Default to IP if no hostname
                
                # Try to get hostname from hostnames if available
                if "hostnames" in host:
                    for h in host.get("hostnames", []):
                        if h.get("name"):
                            hostname = h.get("name")
                            break
                
                # Create or get target node
                target_node_id = self._get_or_create_target_node(hostname, ip)
                
                # Process ports/services
                for port in host.get("ports", []):
                    port_num = port.get("number")
                    service = port.get("service", {})
                    
                    # Create service node
                    service_node_id = self._get_next_node_id()
                    service_node = {
                        "id": service_node_id,
                        "type": "service",
                        "name": service.get("name", "unknown"),
                        "port": port_num,
                        "product": service.get("product", ""),
                        "version": service.get("version", ""),
                        "extrainfo": service.get("extrainfo", "")
                    }
                    
                    self.unified_data["nodes"].append(service_node)
                    
                    # Create relationship
                    self.unified_data["relationships"].append({
                        "source": target_node_id,
                        "target": service_node_id,
                        "type": "runs",
                        "port": port_num,
                        "discovered_at": self.timestamp
                    })
                    
                    # Process scripts for additional info
                    scripts = port.get("scripts", {})
                    for script_name, script_output in scripts.items():
                        if script_name == "http-server-header":
                            self._process_server_header(script_output, target_node_id)
        
        except Exception as e:
            print(f"Error processing Nmap HTTP file {file_path}: {e}")
    
    def _process_ffuf_dirs_file(self, file_path: str) -> None:
        """Process an FFuf directory scan result file"""
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
            
            # Add source info
            self.unified_data["scan_info"]["scan_sources"].append({
                "tool": "ffuf_dirs",
                "file": os.path.basename(file_path),
                "timestamp": self._extract_timestamp_from_file(file_path)
            })
            
            target_url = data.get("target", "")
            hostname = self._extract_domain_from_url(target_url)
            
            # Create or get target node
            target_node_id = self._get_or_create_target_node(hostname)
            
            # Process findings
            for finding in data.get("findings", []):
                url = finding.get("url", "")
                path = self._extract_path_from_url(url)
                redirect_location = finding.get("redirectlocation", "")
                
                # Create resource node
                resource_node_id = self._get_next_node_id()
                
                # Determine if this is a directory or file
                is_directory = False
                if path.endswith('/'):
                    is_directory = True
                elif '.' not in path.split('/')[-1]:
                    is_directory = True
                elif finding.get("status", 0) == 301 and redirect_location and redirect_location.endswith('/'):
                    is_directory = True
                
                resource_node = {
                    "id": resource_node_id,
                    "type": "resource",
                    "path": path,
                    "resource_type": "directory" if is_directory else "file",
                    "status_code": finding.get("status", 0),
                    "content_length": finding.get("length", 0),
                    "content_type": finding.get("content-type", ""),
                    "is_interesting": self._is_interesting_path(path)
                }
                
                self.unified_data["nodes"].append(resource_node)
                
                # Create relationship
                self.unified_data["relationships"].append({
                    "source": target_node_id,
                    "target": resource_node_id,
                    "type": "hosts",
                    "discovered_at": self.timestamp
                })
                
                # Check if there's a redirect to a subdomain
                if redirect_location:
                    redirect_domain = self._extract_domain_from_url(redirect_location)
                    
                    # If it's a different domain/subdomain than the target
                    if redirect_domain and redirect_domain != hostname:
                        # Create the subdomain node
                        subdomain_node_id = self._get_or_create_target_node(redirect_domain)
                        
                        # Get the main domain (extracting from the hostname)
                        main_domain = '.'.join(hostname.split('.')[-2:]) if len(hostname.split('.')) > 1 else hostname
                        main_domain_node_id = self._get_or_create_target_node(main_domain)
                        
                        # Create relationship to base domain (assuming it's a subdomain)
                        self.unified_data["relationships"].append({
                            "source": subdomain_node_id,
                            "target": main_domain_node_id,
                            "type": "subdomain_of",
                            "discovered_at": self.timestamp,
                            "status_code": finding.get("status", 0),
                            "discovery_method": "redirect",
                            "redirected_from": path  # Use path instead of hostname
                        })
        except Exception as e:
            print(f"Error processing FFuf directory file {file_path}: {e}")
    
    def _subdomain_exists(self, subdomain: str) -> bool:
        """Check if a subdomain already exists in the nodes"""
        for node in self.unified_data["nodes"]:
            if node.get("type") == "host" and node.get("hostname") == subdomain:
                return True
        return False
    
    def _process_ffuf_subs_file(self, file_path: str) -> None:
        """Process an FFuf subdomain scan result file"""
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
            
            # Add source info
            self.unified_data["scan_info"]["scan_sources"].append({
                "tool": "ffuf_subs",
                "file": os.path.basename(file_path),
                "timestamp": self._extract_timestamp_from_file(file_path)
            })
            
            base_domain = data.get("domain", "")
            # If base domain is empty, try to extract from the file name
            if not base_domain:
                base_domain = self._extract_domain_from_filename(file_path)
                
            base_node_id = self._get_or_create_target_node(base_domain)
            
            # Process subdomains from either format
            if "subdomains" in data:
                # Standard format
                for subdomain in data.get("subdomains", []):
                    subdomain_name = subdomain.get("subdomain", "")
                    
                    # Create subdomain node
                    subdomain_node_id = self._get_or_create_target_node(subdomain_name)
                    
                    # Create relationship to base domain
                    self.unified_data["relationships"].append({
                        "source": subdomain_node_id,
                        "target": base_node_id,
                        "type": "subdomain_of",
                        "discovered_at": self.timestamp
                    })
            
            # Alternative format with "results" field
            if "results" in data:
                for result in data.get("results", []):
                    url = result.get("url", "")
                    host = result.get("host", "")
                    redirect_location = result.get("redirectlocation", "")
                    
                    # Use host if available, otherwise extract from URL
                    subdomain_name = host if host else self._extract_domain_from_url(url)
                    
                    if subdomain_name:
                        # Create subdomain node
                        subdomain_node_id = self._get_or_create_target_node(subdomain_name)
                        
                        # Create relationship to base domain
                        self.unified_data["relationships"].append({
                            "source": subdomain_node_id,
                            "target": base_node_id,
                            "type": "subdomain_of",
                            "discovered_at": self.timestamp,
                            "status_code": result.get("status", 0),
                            "discovery_method": "scan"
                        })
                        
                        # Check if there's a redirect to another subdomain
                        if redirect_location:
                            redirect_domain = self._extract_domain_from_url(redirect_location)
                            
                            # If it's a different domain/subdomain than the current one
                            if redirect_domain and redirect_domain != subdomain_name:
                                # Create the redirected subdomain node
                                redirect_node_id = self._get_or_create_target_node(redirect_domain)
                                
                                # Create relationship between redirected subdomain and base domain
                                self.unified_data["relationships"].append({
                                    "source": redirect_node_id,
                                    "target": base_node_id,
                                    "type": "subdomain_of",
                                    "discovered_at": self.timestamp,
                                    "status_code": result.get("status", 0),
                                    "discovery_method": "redirect",
                                    "redirected_from": subdomain_name
                                })
        
        except Exception as e:
            print(f"Error processing FFuf subdomains file {file_path}: {e}")
    
    def _extract_domain_from_filename(self, file_path: str) -> str:
        """Extract domain from filename"""
        filename = os.path.basename(file_path)
        patterns = [
            r'ffuf_subs_([^_\.]+)',
            r'ffuf_dirs_http_([^_\.]+)',
            r'nmap_http_([^_\.]+)',
            r'whatweb_([^_\.]+)'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, filename)
            if match:
                return match.group(1)
        
        return "unknown"
    
    def _extract_domain_from_url(self, url: str) -> str:
        """Extract domain from URL"""
        if not url:
            return "unknown"
            
        # Remove protocol
        domain = url.replace("http://", "").replace("https://", "")
        
        # Remove path and query string
        domain = domain.split("/")[0]
        
        # Remove port if present
        domain = domain.split(":")[0]
        
        return domain
    
    def _extract_ip_from_url(self, url: str) -> Optional[str]:
        """Extract IP from URL if present"""
        domain = self._extract_domain_from_url(url)
        
        # Check if domain is an IP address
        ip_pattern = r'^(\d{1,3}\.){3}\d{1,3}$'
        if re.match(ip_pattern, domain):
            return domain
        
        return None
    
    def _extract_path_from_url(self, url: str) -> str:
        """Extract path from URL"""
        if not url:
            return "/"
            
        # Remove protocol
        path = url.replace("http://", "").replace("https://", "")
        
        # Remove domain
        parts = path.split("/", 1)
        if len(parts) > 1:
            return "/" + parts[1]
        
        return "/"
    
    def _extract_timestamp_from_file(self, file_path: str) -> str:
        """Extract timestamp from filename"""
        match = re.search(r'_(\d{8}-\d{6})', os.path.basename(file_path))
        if match:
            return match.group(1)
        return self.timestamp
    
    def _categorize_technology(self, tech_name: str) -> str:
        """Categorize technology based on name"""
        categories = {
            "cms": ["WordPress", "Drupal", "Joomla", "Magento", "TYPO3"],
            "web_server": ["Apache", "Nginx", "IIS", "LiteSpeed", "Tomcat"],
            "programming_language": ["PHP", "Ruby", "Python", "ASP.NET", "Java"],
            "javascript_framework": ["jQuery", "React", "Angular", "Vue", "Next.js"],
            "analytics": ["Google Analytics", "Matomo", "Plausible"],
            "cdn": ["Cloudflare", "Akamai", "Fastly", "CloudFront"],
            "database": ["MySQL", "PostgreSQL", "MongoDB", "SQLite", "Oracle"],
            "operating_system": ["Windows", "Linux", "Ubuntu", "CentOS", "Debian"]
        }
        
        for category, techs in categories.items():
            if any(tech.lower() in tech_name.lower() for tech in techs):
                return category
                
        return "other"
    
    def _is_interesting_path(self, path: str) -> bool:
        """Check if a path is potentially interesting/sensitive"""
        interesting_patterns = [
            '.env', '.git', 'admin', 'backup', 'config', '.conf',
            '.db', '.sql', '.bak', '.old', '.swp', '.tmp',
            'phpinfo', 'server-status', '.htpasswd', '.htaccess'
        ]
        
        return any(pattern in path.lower() for pattern in interesting_patterns)
    
    def _process_server_header(self, header_value: str, target_node_id: int) -> None:
        """Process server header to extract technology info"""
        if not header_value:
            return
            
        # Common server header patterns
        server_patterns = [
            (r'Apache/(\d+\.\d+\.\d+)', 'Apache', 'web_server'),
            (r'nginx/(\d+\.\d+\.\d+)', 'Nginx', 'web_server'),
            (r'Microsoft-IIS/(\d+\.\d+)', 'IIS', 'web_server'),
            (r'PHP/(\d+\.\d+\.\d+)', 'PHP', 'programming_language'),
            (r'OpenSSL/(\d+\.\d+\.\d+)', 'OpenSSL', 'security')
        ]
        
        for pattern, name, category in server_patterns:
            match = re.search(pattern, header_value)
            if match:
                version = match.group(1)
                
                # Create technology node
                tech_node_id = self._get_next_node_id()
                tech_node = {
                    "id": tech_node_id,
                    "type": "technology",
                    "name": name,
                    "version": version,
                    "category": category,
                    "confidence": 100
                }
                
                self.unified_data["nodes"].append(tech_node)
                
                # Create relationship
                self.unified_data["relationships"].append({
                    "source": target_node_id,
                    "target": tech_node_id,
                    "type": "uses",
                    "discovered_at": self.timestamp
                })
    
    def process_results(self) -> None:
        """Process all result files in the directory"""
        # Get all JSON files in the results directory
        json_files = glob.glob(os.path.join(self.results_dir, "*.json"))
        
        for file_path in json_files:
            filename = os.path.basename(file_path)
            
            # Skip previously combined files
            if filename.startswith("combined_scan_results_"):
                continue
                
            print(f"Processing {filename}...")
            
            # Determine file type based on filename
            if "whatweb" in filename:
                self._process_whatweb_file(file_path)
            elif "nmap_http" in filename:
                self._process_nmap_http_file(file_path)
            elif "ffuf_dirs" in filename:
                self._process_ffuf_dirs_file(file_path)
            elif "ffuf_subs" in filename:
                self._process_ffuf_subs_file(file_path)
            else:
                print(f"Unknown file type: {filename}")
    
    def generate_sqlite_friendly_output(self) -> Dict[str, Any]:
        """Generate SQLite-friendly output from unified data"""
        # Format data for SQLite import
        sqlite_data = {
            "scan_info": {
                "scan_id": self.unified_data["scan_info"]["scan_id"],
                "timestamp": self.unified_data["scan_info"]["timestamp"],
                "sources": self.unified_data["scan_info"]["scan_sources"]
            },
            "hosts": [],
            "subdomains": [],
            "services": [],
            "resources": [],
            "technologies": [],
            "vulnerabilities": []
        }
        
        # Get a list of valid hostnames (non-empty and not "unknown")
        valid_hosts = {}
        main_domain = None
        
        # First pass to identify the main domain and valid hosts
        for node in self.unified_data["nodes"]:
            if node.get("type") == "host":
                hostname = node.get("hostname", "")
                if hostname and hostname != "unknown" and hostname != "":
                    valid_hosts[node["id"]] = hostname
                    # Assume the first valid hostname with no dots is the main domain
                    # or the first valid hostname if no hostname without dots is found
                    if main_domain is None or ("." not in hostname and "." in main_domain):
                        main_domain = hostname
        
        # If no valid hostname was found, use a default
        if main_domain is None:
            main_domain = "unknown_domain"
        
        # Process nodes by type
        for node in self.unified_data["nodes"]:
            node_type = node.get("type")
            
            if node_type == "host":
                hostname = node.get("hostname", "")
                
                # Skip empty or unknown hostnames
                if not hostname or hostname == "unknown" or hostname == "":
                    continue
                
                sqlite_data["hosts"].append({
                    "scan_id": self.unified_data["scan_info"]["scan_id"],
                    "hostname": hostname,
                    "ip_addresses": node.get("ip_addresses", []),
                    "first_seen": node.get("first_seen", ""),
                    "last_seen": node.get("last_seen", "")
                })
            
            elif node_type == "service":
                host_id = self._find_relationship_source(node["id"], "runs")
                
                # If host_id isn't valid, use the main domain
                if host_id not in valid_hosts:
                    host_id = main_domain
                
                sqlite_data["services"].append({
                    "scan_id": self.unified_data["scan_info"]["scan_id"],
                    "host_id": host_id,
                    "name": node.get("name", ""),
                    "port": node.get("port", 0),
                    "product": node.get("product", ""),
                    "version": node.get("version", ""),
                    "discovered_at": self.timestamp
                })
            
            elif node_type == "resource":
                host_id = self._find_relationship_source(node["id"], "hosts")
                
                # If host_id isn't valid, use the main domain
                if host_id not in valid_hosts:
                    host_id = main_domain
                
                sqlite_data["resources"].append({
                    "scan_id": self.unified_data["scan_info"]["scan_id"],
                    "host_id": host_id,
                    "path": node.get("path", ""),
                    "resource_type": node.get("resource_type", "file"),
                    "status_code": node.get("status_code", 0),
                    "content_length": node.get("content_length", 0),
                    "content_type": node.get("content_type", ""),
                    "is_interesting": node.get("is_interesting", False),
                    "discovered_at": self.timestamp
                })
            
            elif node_type == "technology":
                host_id = self._find_relationship_source(node["id"], "uses")
                
                # If host_id isn't valid, use the main domain
                if host_id not in valid_hosts:
                    host_id = main_domain
                
                sqlite_data["technologies"].append({
                    "scan_id": self.unified_data["scan_info"]["scan_id"],
                    "host_id": host_id,
                    "name": node.get("name", ""),
                    "version": node.get("version", ""),
                    "category": node.get("category", ""),
                    "confidence": node.get("confidence", 0),
                    "discovered_at": self.timestamp
                })
        
        # Process subdomain relationships
        for relationship in self.unified_data["relationships"]:
            if relationship.get("type") == "subdomain_of":
                source_id = relationship.get("source")
                source_node = self._find_node_by_id(source_id)
                
                if source_node and source_node.get("type") == "host":
                    source_hostname = source_node.get("hostname", "")
                    
                    # Skip empty or unknown hostnames
                    if not source_hostname or source_hostname == "unknown" or source_hostname == "":
                        continue
                        
                    parent_id = relationship.get("target")
                    parent_node = self._find_node_by_id(parent_id)
                    
                    parent_hostname = parent_node.get("hostname", "") if parent_node else main_domain
                    if not parent_hostname or parent_hostname == "unknown" or parent_hostname == "":
                        parent_hostname = main_domain
                    
                    # Add to subdomains list
                    subdomain_entry = {
                        "scan_id": self.unified_data["scan_info"]["scan_id"],
                        "subdomain": source_hostname,
                        "parent_domain": parent_hostname,
                        "status_code": relationship.get("status_code", 0),
                        "discovery_method": relationship.get("discovery_method", "scan"),
                        "discovered_at": relationship.get("discovered_at", self.timestamp)
                    }
                    
                    # Add redirect information if this subdomain was discovered via redirect
                    if relationship.get("discovery_method") == "redirect" and relationship.get("redirected_from"):
                        subdomain_entry["redirected_from"] = relationship.get("redirected_from")
                    
                    # Check if this subdomain is already in the list (avoid duplicates)
                    is_duplicate = False
                    for existing in sqlite_data["subdomains"]:
                        if existing["subdomain"] == subdomain_entry["subdomain"]:
                            is_duplicate = True
                            break
                    
                    if not is_duplicate:
                        sqlite_data["subdomains"].append(subdomain_entry)
        
        return sqlite_data
    
    def _find_relationship_source(self, target_id: int, rel_type: str) -> Optional[str]:
        """Find source hostname for a relationship"""
        for rel in self.unified_data["relationships"]:
            if rel.get("target") == target_id and rel.get("type") == rel_type:
                source_id = rel.get("source")
                source_node = self._find_node_by_id(source_id)
                if source_node and source_node.get("type") == "host":
                    return source_node.get("hostname", "")
        return None
    
    def _find_node_by_id(self, node_id: int) -> Optional[Dict]:
        """Find a node by ID"""
        for node in self.unified_data["nodes"]:
            if node.get("id") == node_id:
                return node
        return None
    
    def save_output(self) -> None:
        """Save the SQLite-friendly output to a file"""
        sqlite_data = self.generate_sqlite_friendly_output()
        
        with open(self.output_file, 'w') as f:
            json.dump(sqlite_data, f, indent=2)
        
        print(f"Combined scan results saved to: {self.output_file}")
        
        # Count directories from the resources
        dir_count = 0
        for resource in sqlite_data.get('resources', []):
            if resource.get('resource_type') == 'directory':
                dir_count += 1
        
        # Print summary
        print("\nSummary:")
        print(f"Hosts: {len(sqlite_data['hosts'])}")
        print(f"Subdomains: {len(sqlite_data['subdomains'])}")
        print(f"Services: {len(sqlite_data['services'])}")
        print(f"Resources: {len(sqlite_data['resources'])}")
        print(f"Directories: {dir_count}")
        print(f"Files: {len(sqlite_data['resources']) - dir_count}")
        print(f"Technologies: {len(sqlite_data['technologies'])}")
        print(f"Vulnerabilities: {len(sqlite_data['vulnerabilities'])}")

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Combine and format scan results for SQLite import")
    parser.add_argument("--results-dir", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "results"),
                        help="Directory containing scan results (default: ../results)")
    parser.add_argument("--output", help="Output file path (default: combined_scan_results_TIMESTAMP.json in results dir)")
    
    args = parser.parse_args()
    
    formatter = ScanFormatter(args.results_dir, args.output)
    formatter.process_results()
    formatter.save_output()

if __name__ == "__main__":
    main()
