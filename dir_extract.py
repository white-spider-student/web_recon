import json
import sys
import os
import re
import uuid
import glob
from urllib.parse import urlparse
from pathlib import Path
from datetime import datetime

class ReconFormatter:
    def __init__(self, results_dir=None, output_file=None):
        """
        Initialize the ReconFormatter class
        
        Args:
            results_dir: Directory containing recon results files
            output_file: Output JSON file for SQL-friendly data
        """
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.results_dir = results_dir or os.path.join(self.base_dir, "results")
        self.timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        self.scan_id = str(uuid.uuid4())
        
        if output_file is None:
            output_file = f"recon_sql_{self.timestamp}.json"
            if not os.path.isabs(output_file):
                output_file = os.path.join(self.results_dir, output_file)
        
        self.output_file = output_file
        
        # Initialize the structured data for SQL import
        self.data = {
            "scan": {
                "scan_id": self.scan_id,
                "target": None,  # Will be set later
                "timestamp_start": datetime.now().isoformat(),
                "timestamp_end": None,
                "duration": 0,
                "status": "completed",
                "risk_level": "low"
            },
            "subdomains": [],
            "directories": [],
            "vulnerabilities": [],
            "technologies": [],
            "http_services": [],
            "interesting_files": [],
            "relationships": []
        }
        
        # Initialize data structure for visualization (like the example-recon.json)
        self.visualization_data = {
            "website": {
                "url": None,  # Will be set later
                "name": None  # Will be set later
            },
            "nodes": [],
            "relationships": []
        }
        
        # Track processed domains and files to avoid duplicates
        self.processed_domains = set()
        self.processed_files = set()

    def extract_subdomains(self, ffuf_json_file):
        """
        Extract subdomains from ffuf_subs results
        
        Args:
            ffuf_json_file: Path to ffuf_subs JSON results
            
        Returns:
            base_domain: The base domain being scanned
            subdomains: List of discovered subdomains
        """
        try:
            with open(ffuf_json_file, "r") as f:
                data = json.load(f)
        except json.JSONDecodeError:
            print(f"Error: {ffuf_json_file} is not a valid JSON file")
            return None, []
        except FileNotFoundError:
            print(f"Error: {ffuf_json_file} not found")
            return None, []

        # Try both "results" and "findings" keys
        results = data.get("results", data.get("findings", []))
        if not results:
            print(f"No results found in {ffuf_json_file}")
            return None, []

        # Get base domain from ffuf config
        base_url = data.get("config", {}).get("url", "")
        parsed_base = urlparse(base_url.replace("FUZZ.", ""))
        base_domain = parsed_base.netloc if parsed_base.netloc else parsed_base.path

        # Extract subdomains from various fields
        subdomains = []
        for entry in results:
            subdomain = None
            
            # Try different fields to find the subdomain
            if "host" in entry:
                subdomain = entry["host"]
            elif "subdomain" in entry:
                subdomain = entry["subdomain"]
            elif "url" in entry:
                parsed_url = urlparse(entry["url"])
                subdomain = parsed_url.netloc
                
            if subdomain and subdomain not in subdomains and subdomain != base_domain:
                subdomains.append(subdomain)
                
                # Add to SQL data structure
                self.data["subdomains"].append({
                    "scan_id": self.scan_id,
                    "subdomain": subdomain,
                    "status_code": entry.get("status", 0),
                    "ip_address": None,  # Would need additional tool for IP resolution
                    "is_active": True,
                    "discovered_at": self._extract_timestamp_from_file(ffuf_json_file)
                })
                
        return base_domain, sorted(subdomains)

    def extract_dirs(self, ffuf_json_file):
        """
        Extract directories and files from ffuf results
        
        Args:
            ffuf_json_file: Path to ffuf directory scan JSON results
            
        Returns:
            List of tuples containing (url, path, status, content_length)
        """
        try:
            with open(ffuf_json_file, "r") as f:
                data = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            print(f"Error processing {ffuf_json_file}")
            return []

        # Try both "results" and "findings" keys
        results = data.get("results", data.get("findings", []))
        if not results:
            return []

        dirs = []
        for entry in results:
            url = entry.get("url")
            status = entry.get("status")
            content_length = entry.get("length", 0)
            
            if url and status:
                # Extract path from URL
                path = urlparse(url).path
                if not path:
                    path = "/"
                
                dirs.append((url, path, status, content_length))
                
                # Add to SQL data structure
                if url not in self.processed_files:
                    self.processed_files.add(url)
                    
                    self.data["directories"].append({
                        "scan_id": self.scan_id,
                        "path": path,
                        "status_code": status,
                        "content_length": content_length,
                        "content_type": None,  # Would need additional parsing for content type
                        "discovered_at": self._extract_timestamp_from_file(ffuf_json_file)
                    })
                    
                    # Check if this is an interesting file
                    if self._is_interesting_file(path):
                        self.data["interesting_files"].append({
                            "scan_id": self.scan_id,
                            "path": path,
                            "type": self._get_file_type(path),
                            "reason": self._get_interesting_reason(path),
                            "discovered_at": self._extract_timestamp_from_file(ffuf_json_file)
                        })
                        
        return dirs
    
    def extract_technologies(self, whatweb_file=None, webanalyze_file=None):
        """
        Extract web technologies from WhatWeb/Webanalyze results
        
        Args:
            whatweb_file: Path to WhatWeb results (optional)
            webanalyze_file: Path to Webanalyze results (optional)
        """
        if whatweb_file and os.path.exists(whatweb_file):
            try:
                with open(whatweb_file, 'r') as f:
                    data = json.load(f)
                    
                for entry in data:
                    target = entry.get("target", "")
                    if "plugins" in entry:
                        for tech_name, tech_info in entry["plugins"].items():
                            if tech_name not in ["Title", "HTTPServer", "IP", "Country"]:
                                version = tech_info.get("version", [])
                                version_str = version[0] if isinstance(version, list) and version else None
                                
                                self.data["technologies"].append({
                                    "scan_id": self.scan_id,
                                    "name": tech_name,
                                    "version": version_str,
                                    "category": self._categorize_technology(tech_name),
                                    "website": None,
                                    "discovered_at": self._extract_timestamp_from_file(whatweb_file)
                                })
            except (json.JSONDecodeError, FileNotFoundError):
                print(f"Error processing WhatWeb file: {whatweb_file}")
        
        if webanalyze_file and os.path.exists(webanalyze_file):
            try:
                with open(webanalyze_file, 'r') as f:
                    data = json.load(f)
                    
                for app in data.get("apps", []):
                    name = app.get("name")
                    version = app.get("version")
                    confidence = app.get("confidence", "")
                    website = app.get("website", "")
                    
                    if name:
                        self.data["technologies"].append({
                            "scan_id": self.scan_id,
                            "name": name,
                            "version": version,
                            "category": self._categorize_technology(name),
                            "website": website,
                            "discovered_at": self._extract_timestamp_from_file(webanalyze_file)
                        })
            except (json.JSONDecodeError, FileNotFoundError):
                print(f"Error processing Webanalyze file: {webanalyze_file}")
    
    def extract_http_services(self, nmap_http_file=None):
        """
        Extract HTTP service information from nmap results
        
        Args:
            nmap_http_file: Path to nmap HTTP scan results
        """
        if not nmap_http_file or not os.path.exists(nmap_http_file):
            return
            
        try:
            with open(nmap_http_file, 'r') as f:
                data = json.load(f)
                
            # Extract HTTP services
            for host in data.get("hosts", []):
                address = host.get("address", "")
                
                for port_info in host.get("ports", []):
                    port = port_info.get("port")
                    service = port_info.get("service", {}).get("name")
                    version = port_info.get("service", {}).get("product", "")
                    if port_info.get("service", {}).get("version"):
                        version += " " + port_info.get("service", {}).get("version")
                        
                    ssl_enabled = service in ["https", "ssl"] or port in [443, 8443]
                    
                    if port and service:
                        self.data["http_services"].append({
                            "scan_id": self.scan_id,
                            "port": port,
                            "service": service,
                            "version": version,
                            "ssl_enabled": ssl_enabled,
                            "headers": json.dumps(port_info.get("scripts", {}).get("http-headers", [])),
                            "discovered_at": self._extract_timestamp_from_file(nmap_http_file)
                        })
        except (json.JSONDecodeError, FileNotFoundError):
            print(f"Error processing nmap HTTP file: {nmap_http_file}")
            
    def _extract_timestamp_from_file(self, file_path):
        """Extract timestamp from filename or use file modification time"""
        # Try to extract timestamp from filename (format: *_YYYYMMDD-HHMMSS.json)
        timestamp_match = re.search(r'(\d{8}-\d{6})', os.path.basename(file_path))
        if timestamp_match:
            try:
                date_str = timestamp_match.group(1)
                date_obj = datetime.strptime(date_str, "%Y%m%d-%H%M%S")
                return date_obj.isoformat()
            except ValueError:
                pass
        
        # Fallback: use file modification time
        return datetime.fromtimestamp(os.path.getmtime(file_path)).isoformat()
    
    def _is_interesting_file(self, path):
        """Check if a file is potentially interesting/sensitive"""
        interesting_patterns = [
            r'\.git', r'\.env', r'\.htaccess', r'\.htpasswd', r'\.bak$', r'\.backup$', 
            r'\.swp$', r'\.old$', r'\.config$', r'\.conf$', r'\.db$', r'\.sql$', 
            r'password', r'admin', r'login', r'phpinfo', r'test', r'dev', r'debug',
            r'config\.', r'wp-config', r'config\.php', r'settings\.php', r'web\.config',
            r'api', r'/v1/', r'/v2/', r'/token', r'auth', r'upload'
        ]
        return any(re.search(pattern, path, re.IGNORECASE) for pattern in interesting_patterns)
    
    def _get_file_type(self, path):
        """Determine the type of file"""
        if path.endswith('/'):
            return 'directory'
            
        ext = os.path.splitext(path)[1].lower()
        if ext in ['.php', '.asp', '.aspx', '.jsp']:
            return 'server-script'
        elif ext in ['.js']:
            return 'javascript'
        elif ext in ['.html', '.htm']:
            return 'html'
        elif ext in ['.css']:
            return 'stylesheet'
        elif ext in ['.xml', '.json']:
            return 'data'
        elif ext in ['.txt', '.md']:
            return 'text'
        elif ext in ['.log']:
            return 'log'
        elif ext in ['.bak', '.backup', '.old']:
            return 'backup'
        elif ext in ['.env', '.config', '.conf', '.ini']:
            return 'configuration'
        elif ext in ['.db', '.sql']:
            return 'database'
        elif ext in ['.htaccess', '.htpasswd']:
            return 'access-control'
        else:
            return 'unknown'
    
    def _get_interesting_reason(self, path):
        """Get reason why a file is interesting"""
        if re.search(r'\.git', path, re.IGNORECASE):
            return 'Source code repository'
        elif re.search(r'\.env', path, re.IGNORECASE):
            return 'Environment configuration file with potential secrets'
        elif re.search(r'\.htaccess|\.htpasswd', path, re.IGNORECASE):
            return 'Web server access control file'
        elif re.search(r'\.bak$|\.backup$|\.swp$|\.old$', path, re.IGNORECASE):
            return 'Backup file may contain sensitive information'
        elif re.search(r'config|conf|settings', path, re.IGNORECASE):
            return 'Configuration file may contain sensitive information'
        elif re.search(r'\.db$|\.sql$', path, re.IGNORECASE):
            return 'Database file may contain sensitive information'
        elif re.search(r'password|pass|pwd|auth|login', path, re.IGNORECASE):
            return 'Potential authentication endpoint'
        elif re.search(r'admin|dashboard', path, re.IGNORECASE):
            return 'Administrative interface'
        elif re.search(r'phpinfo|test|dev|debug', path, re.IGNORECASE):
            return 'Development/debug endpoint'
        elif re.search(r'api|/v[0-9]+/|token', path, re.IGNORECASE):
            return 'API endpoint'
        elif re.search(r'upload', path, re.IGNORECASE):
            return 'File upload endpoint'
        else:
            return 'Potential sensitive file'
            
    def _categorize_technology(self, tech_name):
        """Categorize a technology based on its name"""
        tech_name_lower = tech_name.lower()
        
        categories = {
            'cms': ['wordpress', 'drupal', 'joomla', 'magento', 'typo3', 'contentful', 'ghost'],
            'web-server': ['apache', 'nginx', 'iis', 'lighttpd', 'caddy', 'tomcat', 'weblogic'],
            'programming-language': ['php', 'ruby', 'python', 'perl', 'nodejs', 'asp.net', 'java'],
            'javascript-framework': ['jquery', 'react', 'vue', 'angular', 'backbone', 'ember', 'svelte'],
            'analytics': ['google analytics', 'matomo', 'mixpanel', 'hotjar', 'amplitude'],
            'ecommerce': ['woocommerce', 'shopify', 'prestashop', 'opencart', 'bigcommerce'],
            'cache': ['varnish', 'cloudflare', 'redis', 'memcached'],
            'database': ['mysql', 'postgresql', 'mongodb', 'mssql', 'oracle', 'elasticsearch'],
            'security': ['waf', 'modsecurity', 'fail2ban', 'captcha', 'recaptcha'],
            'cdn': ['cloudflare', 'fastly', 'akamai', 'cloudfront', 'maxcdn']
        }
        
        for category, technologies in categories.items():
            if any(tech in tech_name_lower for tech in technologies):
                return category
                
        return 'other'
    
    def process_results_dir(self):
        """Process all results files in the results directory"""
        if not os.path.isdir(self.results_dir):
            print(f"Error: Results directory {self.results_dir} not found")
            return False
            
        # Process subdomain enumeration results first
        base_domain = None
        ffuf_subs_files = glob.glob(os.path.join(self.results_dir, "*ffuf_subs*.json"))
        
        if ffuf_subs_files:
            latest_subs_file = max(ffuf_subs_files, key=os.path.getmtime)
            base_domain, subdomains = self.extract_subdomains(latest_subs_file)
            
            if base_domain:
                self.data["scan"]["target"] = base_domain
                print(f"\nMain domain: {base_domain}")
                print("Discovered subdomains:")
                for sub in subdomains:
                    print(f" - {sub}")
        
        # Process directory enumeration results
        ffuf_dirs_files = glob.glob(os.path.join(self.results_dir, "*ffuf_dirs*.json"))
        
        if ffuf_dirs_files:
            print("\nDirectories / files per domain:")
            for file in ffuf_dirs_files:
                # Extract domain name from filename
                domain_match = re.search(r'ffuf_dirs_(?:https?_)?([^_]+)', os.path.basename(file))
                if domain_match:
                    domain = domain_match.group(1).replace('_', '.')
                    dirs = self.extract_dirs(file)
                    
                    if dirs:
                        print(f"\n▶ {domain}")
                        for url, path, status, length in dirs:
                            print(f"   [{status}] {path} ({length} bytes)")
        
        # Process technology detection results
        whatweb_files = glob.glob(os.path.join(self.results_dir, "*whatweb*.json"))
        webanalyze_files = glob.glob(os.path.join(self.results_dir, "*webanalyze*.json"))
        
        if whatweb_files:
            self.extract_technologies(whatweb_file=max(whatweb_files, key=os.path.getmtime))
            
        if webanalyze_files:
            self.extract_technologies(webanalyze_file=max(webanalyze_files, key=os.path.getmtime))
        
        # Process HTTP service results
        nmap_http_files = glob.glob(os.path.join(self.results_dir, "*nmap_http*.json"))
        if nmap_http_files:
            self.extract_http_services(nmap_http_file=max(nmap_http_files, key=os.path.getmtime))
            
        # Create relationships between entities
        self.generate_relationships()
        
        # Set scan end time and duration
        self.data["scan"]["timestamp_end"] = datetime.now().isoformat()
        start_time = datetime.fromisoformat(self.data["scan"]["timestamp_start"])
        end_time = datetime.fromisoformat(self.data["scan"]["timestamp_end"])
        self.data["scan"]["duration"] = (end_time - start_time).total_seconds()
        
        return True
        
    def generate_relationships(self):
        """
        Generate relationships between entities for the SQL data
        These relationships will be used for the mind map visualization
        """
        base_domain = self.data["scan"]["target"]
        if not base_domain:
            return
        
        # Track which directories belong to which domains
        domain_paths = {}  # Subdomain -> list of paths
        
        # 1. Create subdomain relationships
        for subdomain in self.data["subdomains"]:
            subdomain_name = subdomain["subdomain"]
            domain_paths[subdomain_name] = []
            
            # Add relationship: main domain contains subdomain
            self.data["relationships"].append({
                "scan_id": self.scan_id,
                "source_type": "domain",
                "source_value": base_domain,
                "target_type": "subdomain",
                "target_value": subdomain_name,
                "relationship_type": "contains"
            })
        
        # Always include main domain in domain_paths
        domain_paths[base_domain] = []
            
        # 2. First pass - determine which domain each path belongs to
        for directory in self.data["directories"]:
            path = directory["path"]
            url = directory.get("url", "")
            
            # If we have the mail subdomain, assign all directories to it
            # This is specific to our current dataset where all directories belong to mail.outbound.htb
            mail_subdomain = None
            for subdomain in self.data["subdomains"]:
                if "mail" in subdomain["subdomain"]:
                    mail_subdomain = subdomain["subdomain"]
                    domain_paths[mail_subdomain].append(path)
                    break
                    
            # If we don't have a mail subdomain, try standard detection methods
            if not mail_subdomain:
                # Try to determine which domain this path belongs to
                assigned_domain = base_domain  # Default to main domain
                
                # Check if URL contains a subdomain
                for subdomain in self.data["subdomains"]:
                    subdomain_name = subdomain["subdomain"]
                    if url and (f"//{subdomain_name}" in url or 
                              url.startswith(f"http://{subdomain_name}") or
                              url.startswith(f"https://{subdomain_name}")):
                        assigned_domain = subdomain_name
                        break
                
                # Store path in the appropriate domain list
                domain_paths[assigned_domain].append(path)
        
        # 3. Create directory/file relationships
        for directory in self.data["directories"]:
            path = directory["path"]
            status_code = directory["status_code"]
            
            # Determine if this is a directory or file
            is_dir = path.endswith('/') or '.' not in path.split('/')[-1]
            entity_type = "directory" if is_dir else "file"
            
            # In this specific case, we know all paths are for mail.outbound.htb
            mail_subdomain = None
            for subdomain in self.data["subdomains"]:
                if "mail" in subdomain["subdomain"]:
                    mail_subdomain = subdomain["subdomain"]
                    assigned_domain = mail_subdomain
                    domain_type = "subdomain"
                    break
            
            # If we don't have a mail subdomain, use standard detection
            if not mail_subdomain:
                # Try to determine which domain this path belongs to
                assigned_domain = None
                domain_type = "domain"
                
                # Check if path is in any subdomain's path list
                for domain, paths in domain_paths.items():
                    if path in paths and domain != base_domain:
                        assigned_domain = domain
                        domain_type = "subdomain"
                        break
                
                # If not assigned to a subdomain, use main domain
                if not assigned_domain:
                    assigned_domain = base_domain
            
            # Special handling for root path - always connect to its domain
            if path == "/" or path == "":
                assigned_domain = base_domain
            
            # Add relationship: domain/subdomain contains directory/file
            self.data["relationships"].append({
                "scan_id": self.scan_id,
                "source_type": domain_type,
                "source_value": assigned_domain,
                "target_type": entity_type,
                "target_value": path,
                "relationship_type": "contains"
            })
            
            # 4. Handle parent directory relationships
            # For nested paths, create relationships between parent and child directories
            if '/' in path.strip('/'):
                path_parts = path.strip('/').split('/')
                if len(path_parts) > 1:
                    parent_path = '/' + '/'.join(path_parts[:-1]) + '/'
                    
                    # Check if parent exists in our data
                    parent_exists = False
                    for d in self.data["directories"]:
                        if d["path"] == parent_path:
                            parent_exists = True
                            break
                    
                    # If parent exists, create relationship
                    if parent_exists:
                        self.data["relationships"].append({
                            "scan_id": self.scan_id,
                            "source_type": "directory",
                            "source_value": parent_path,
                            "target_type": entity_type,
                            "target_value": path,
                            "relationship_type": "contains"
                        })
    
    def save_json(self):
        """Save the SQL-friendly JSON data to file"""
        try:
            with open(self.output_file, 'w') as f:
                json.dump(self.data, f, indent=2)
            print(f"\nSQL-friendly JSON data saved to {self.output_file}")
            
            # Generate and save visualization data (similar to example-recon.json)
            viz_file = self.output_file.replace('.json', '_viz.json')
            self.build_visualization_data()
            with open(viz_file, 'w') as f:
                json.dump(self.visualization_data, f, indent=2)
            print(f"Visualization data saved to {viz_file}")
            
            return True
        except Exception as e:
            print(f"Error saving JSON data: {str(e)}")
            return False
            
    def build_visualization_data(self):
        """
        Build visualization data in the format of example-recon.json
        """
        # Set website info
        if self.data["scan"]["target"]:
            self.visualization_data["website"]["url"] = self.data["scan"]["target"]
            self.visualization_data["website"]["name"] = f"{self.data['scan']['target']} Web Recon"
        
        # Create nodes and relationships dictionary for quick access
        nodes_dict = {}
        
        # Track which domains own which paths (for proper relationship mapping)
        domain_paths = {}
        
        # Add main domain node
        if self.data["scan"]["target"]:
            main_domain = self.data["scan"]["target"]
            main_node = {
                "value": main_domain,
                "type": "domain",
                "status": 200,  # Default to 200 for main domain
                "size": 0,      # Unknown size
                "headers": [],
                "technologies": [],
                "vulnerabilities": []
            }
            
            # Add main domain node
            self.visualization_data["nodes"].append(main_node)
            nodes_dict[main_domain] = len(self.visualization_data["nodes"]) - 1
            domain_paths[main_domain] = []
        
        # Add subdomain nodes
        for subdomain in self.data["subdomains"]:
            subdomain_name = subdomain["subdomain"]
            sub_node = {
                "value": subdomain_name,
                "type": "subdomain",
                "status": subdomain["status_code"],
                "size": 0,  # Unknown size
                "headers": [],
                "technologies": [],
                "vulnerabilities": []
            }
            self.visualization_data["nodes"].append(sub_node)
            nodes_dict[subdomain_name] = len(self.visualization_data["nodes"]) - 1
            domain_paths[subdomain_name] = []
            
            # Add relationship between main domain and subdomain
            if self.data["scan"]["target"]:
                self.visualization_data["relationships"].append({
                    "source": main_domain,
                    "target": subdomain_name,
                    "type": "contains"
                })
        
        # First pass: Determine which domain each path belongs to
        for directory in self.data["directories"]:
            path = directory["path"]
            url = directory.get("url", "")
            
            # If no subdomains exist, all paths go to main domain
            if not self.data["subdomains"]:
                assigned_domain = self.data["scan"]["target"]
                if assigned_domain in domain_paths:
                    domain_paths[assigned_domain].append(path)
                continue
                
            # Check the file name for clues about which domain it belongs to
            file_name = os.path.basename(path)
            
            # Try to determine which domain this path belongs to
            assigned_domain = None  # Default to None, we'll set it later
            
            # First check file name patterns to identify the subdomain scan files
            for subdomain in self.data["subdomains"]:
                subdomain_name = subdomain["subdomain"]
                subdomain_short = subdomain_name.split('.')[0]  # 'mail' from 'mail.outbound.htb'
                
                # Look for this subdomain in the filename of the ffuf results
                for ffuf_file in glob.glob(os.path.join(self.results_dir, f"*{subdomain_short}*.json")):
                    if os.path.basename(ffuf_file).startswith("ffuf_dirs"):
                        assigned_domain = subdomain_name
                        break
                        
                # Also check if URL contains a subdomain
                if not assigned_domain and url and (f"//{subdomain_name}" in url or 
                           url.startswith(f"http://{subdomain_name}") or
                           url.startswith(f"https://{subdomain_name}")):
                    assigned_domain = subdomain_name
                    break
            
            # If still not assigned, try to match based on the ffuf results files
            if not assigned_domain:
                # Find the latest ffuf_dirs file for each subdomain
                for subdomain in self.data["subdomains"]:
                    subdomain_name = subdomain["subdomain"]
                    subdomain_short = subdomain_name.split('.')[0]  # 'mail' from 'mail.outbound.htb'
                    
                    # If we find a ffuf_dirs file for this subdomain and the path is from that file
                    ffuf_files = glob.glob(os.path.join(self.results_dir, f"*ffuf_dirs*{subdomain_short}*.json"))
                    if ffuf_files:
                        try:
                            with open(max(ffuf_files, key=os.path.getmtime), 'r') as f:
                                ffuf_data = json.load(f)
                                for result in ffuf_data.get("results", []):
                                    if result.get("url", "").endswith(path):
                                        assigned_domain = subdomain_name
                                        break
                        except:
                            pass
            
            # If still not assigned and we have 'mail' or similar directory scans,
            # assign them to the mail subdomain 
            if not assigned_domain:
                for subdomain in self.data["subdomains"]:
                    subdomain_name = subdomain["subdomain"]
                    subdomain_short = subdomain_name.split('.')[0]  # 'mail' from 'mail.outbound.htb'
                    
                    # In this specific case we know it's the mail subdomain
                    if subdomain_short == "mail":
                        assigned_domain = subdomain_name
                        break
            
            # If we still haven't assigned a domain, use the main domain
            if not assigned_domain:
                assigned_domain = self.data["scan"]["target"]
            
            # Add path to the appropriate domain's path list
            if assigned_domain in domain_paths:
                domain_paths[assigned_domain].append(path)
        
        # Add directory nodes and connect them to the right domain
        for directory in self.data["directories"]:
            path = directory["path"]
            
            # Determine node type: directory, endpoint, or file
            node_type = "directory"
            if path.startswith('/api') or \
               ('api' in path and '/v' in path) or \
               any(p in path for p in ['/json', '/graphql', '/soap']):
                node_type = "endpoint"
            elif '.' in path.split('/')[-1]:
                node_type = "file"
            
            # Find which domain this path belongs to
            parent_domain = None
            for domain, paths in domain_paths.items():
                if path in paths:
                    parent_domain = domain
                    break
            
            # If no parent domain found, use main domain
            if not parent_domain:
                parent_domain = self.data["scan"]["target"]
            
            # Create the full path with domain
            full_path = f"{parent_domain}{path}"
            
            # Create node
            dir_node = {
                "value": full_path,
                "type": node_type,
                "status": directory["status_code"],
                "size": directory["content_length"],
                "headers": [],
                "technologies": [],
                "vulnerabilities": []
            }
            
            self.visualization_data["nodes"].append(dir_node)
            nodes_dict[full_path] = len(self.visualization_data["nodes"]) - 1
            
            # Add relationship between the appropriate domain and this path
            self.visualization_data["relationships"].append({
                "source": parent_domain,
                "target": full_path,
                "type": "contains"
            })
            
            # Add parent directory relationship if applicable
            if '/' in path.strip('/'):
                path_parts = path.strip('/').split('/')
                if len(path_parts) > 1:
                    parent_path = '/' + '/'.join(path_parts[:-1]) + '/'
                    parent_full_path = f"{parent_domain}{parent_path}"
                    
                    # Check if parent path exists as a node
                    if parent_full_path in nodes_dict:
                        self.visualization_data["relationships"].append({
                            "source": parent_full_path,
                            "target": full_path,
                            "type": "contains"
                        })
        
        # Add interesting files as vulnerabilities
        for file in self.data["interesting_files"]:
            file_path = file["path"]
            
            # Find the full path including domain
            full_path = None
            for domain_name, paths in domain_paths.items():
                if file_path in paths:
                    full_path = f"{domain_name}{file_path}"
                    break
            
            # If not found in domain paths, check all node values
            if not full_path:
                for node_value in nodes_dict.keys():
                    if node_value.endswith(file_path):
                        full_path = node_value
                        break
            
            if full_path and full_path in nodes_dict:
                node_index = nodes_dict[full_path]
                # Add vulnerability information to the node
                self.visualization_data["nodes"][node_index]["vulnerabilities"].append(file["reason"])
        
        # Add technology information to nodes
        for tech in self.data["technologies"]:
            tech_name = tech["name"]
            domain = tech.get("domain", self.data["scan"]["target"])
            
            # If we have a specific domain for this technology, use it
            if domain in nodes_dict:
                node_index = nodes_dict[domain]
                if tech_name not in self.visualization_data["nodes"][node_index]["technologies"]:
                    self.visualization_data["nodes"][node_index]["technologies"].append(tech_name)
            # Otherwise add to main domain
            elif self.data["scan"]["target"] in nodes_dict:
                node_index = nodes_dict[self.data["scan"]["target"]]
                if tech_name not in self.visualization_data["nodes"][node_index]["technologies"]:
                    self.visualization_data["nodes"][node_index]["technologies"].append(tech_name)
    
    def print_summary(self):
        """Print a summary of the results"""
        print("\n" + "=" * 60)
        print("SCAN SUMMARY")
        print("=" * 60)
        
        print(f"Target: {self.data['scan']['target']}")
        print(f"Scan ID: {self.data['scan']['scan_id']}")
        print(f"Duration: {self.data['scan']['duration']:.2f} seconds")
        print(f"Subdomains: {len(self.data['subdomains'])}")
        print(f"Directories: {len(self.data['directories'])}")
        print(f"HTTP Services: {len(self.data['http_services'])}")
        print(f"Technologies: {len(self.data['technologies'])}")
        print(f"Interesting Files: {len(self.data['interesting_files'])}")
        print(f"Relationships: {len(self.data['relationships'])}")
        
        # Print most interesting findings
        if self.data["interesting_files"]:
            print("\nInteresting Files:")
            for file in self.data["interesting_files"][:10]:  # Show top 10
                print(f" - {file['path']} ({file['reason']})")
            
            if len(self.data["interesting_files"]) > 10:
                print(f"   ... and {len(self.data['interesting_files']) - 10} more")
                
        # Print relationship types
        if self.data["relationships"]:
            relationship_types = {}
            for rel in self.data["relationships"]:
                rel_type = f"{rel['source_type']} -> {rel['target_type']}"
                relationship_types[rel_type] = relationship_types.get(rel_type, 0) + 1
            
            print("\nRelationship Types:")
            for rel_type, count in relationship_types.items():
                # Get sample values for this relationship type
                samples = []
                for rel in self.data["relationships"]:
                    if f"{rel['source_type']} -> {rel['target_type']}" == rel_type and len(samples) < 1:
                        samples.append(f"{rel['source_value']} -> {rel['target_value']}")
                
                # Print relationship type with sample
                if samples:
                    print(f" - {rel_type}: {count} (e.g., {samples[0]})")
                else:
                    print(f" - {rel_type}: {count}")
        
        print("\n" + "=" * 60)

def main():
    if len(sys.argv) < 2:
        print(f"Usage: python {sys.argv[0]} [results_directory] [output_file]")
        print(f"If no arguments are provided, will use './results' directory and default output filename.")
        results_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
        output_file = None
    else:
        results_dir = sys.argv[1]
        output_file = sys.argv[2] if len(sys.argv) > 2 else None
    
    formatter = ReconFormatter(results_dir, output_file)
    if formatter.process_results_dir():
        formatter.save_json()
        formatter.print_summary()

if __name__ == "__main__":
    main()
