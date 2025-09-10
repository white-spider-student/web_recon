#!/usr/bin/env python3
import subprocess
import os
import signal
import time
import json
import argparse
from typing import Dict, List, Optional, Union

def run(target_url: str, max_time: int = 30) -> str:
    """Run ffuf directory scan and return JSON results as string"""
    scanner = FFUFScanner(target_url=target_url, max_time=max_time)
    results = scanner.run()
    return json.dumps(results)

class FFUFScanner:
    def __init__(self, target_url: str, wordlist: Optional[str] = None, extensions: Optional[List[str]] = None, 
                 threads: int = 50, timeout: int = 10, follow_redirects: bool = True, max_time: int = 30):
        self.target_url = target_url
        self.base_dir = os.path.dirname(os.path.dirname(__file__))
        self.wordlist = wordlist or os.path.join(self.base_dir, "wordlists", "raft-medium-words.txt")
        
        # Enhanced default extensions for better coverage
        self.extensions = extensions or [
            '.php', '.asp', '.aspx', '.jsp', '.html', '.htm', '.js', 
            '.json', '.xml', '.cfg', '.txt', '.md', '.yml', '.yaml',
            '.env', '.conf', '.config', '.bak', '.backup', '.swp',
            '.old', '.db', '.sql', '.api', '.git', '.svn', '.htaccess',
            '.htpasswd', '.ini', '.log', '.tar.gz', '.zip'
        ]
        
        self.threads = threads
        self.timeout = timeout
        self.follow_redirects = follow_redirects
        self.max_time = max_time  # Maximum run time in seconds
        # Calibration filters
        self.calibrated_size = None   # Will store the calibrated size filter
        self.calibrated_words = None  # Will store the calibrated words filter
        self.calibrated_lines = None  # Will store the calibrated lines filter
        
        # Create results directory if it doesn't exist
        self.results_dir = os.path.join(self.base_dir, "results")
        os.makedirs(self.results_dir, exist_ok=True)
        
        # Generate a filename based on the target URL and timestamp
        timestamp = time.strftime("%Y%m%d-%H%M%S")
        url_part = self.target_url.replace("://", "_").replace("/", "_").replace(".", "_")
        self.outfile = os.path.join(self.results_dir, f"ffuf_dirs_{url_part}_{timestamp}.json")
        
        # Initialize enhanced results structure
        self.scan_results = {
            "target": self.target_url,
            "timestamp": timestamp,
            "scan_duration": 0,
            "total_requests": 0,
            "findings": [],
            "interesting_files": [],
            "potential_vulns": [],
            "backup_files": [],
            "statistics": {
                "response_codes": {},
                "mime_types": {},
                "extensions_found": {}
            }
        }

    def categorize_finding(self, result: Dict) -> None:
        """Categorize findings based on patterns and characteristics"""
        url = result.get("url", "")
        content_type = result.get("content-type", "")
        status = result.get("status", 0)
        
        # Check for potential sensitive files
        sensitive_patterns = [
            '.env', '.git', '.svn', '.bak', '.backup', '.swp', '.old',
            'backup', 'admin', 'config', '.conf', '.cfg', '.ini', '.db',
            '.sql', 'phpinfo', '.htpasswd', '.htaccess'
        ]
        
        if any(pattern in url.lower() for pattern in sensitive_patterns):
            self.scan_results["interesting_files"].append(result)
        
        # Check for potential vulnerabilities
        if status == 500:
            self.scan_results["potential_vulns"].append({
                "type": "Internal Server Error",
                "url": url,
                "details": result
            })
        elif status == 401 or status == 403:
            self.scan_results["potential_vulns"].append({
                "type": "Protected Resource",
                "url": url,
                "details": result
            })
        
        # Check for backup files
        backup_patterns = ['.bak', '.backup', '.old', '.swp', '~', '.save']
        if any(pattern in url.lower() for pattern in backup_patterns):
            self.scan_results["backup_files"].append(result)

    def calibrate_size_filter(self) -> None:
        """Calibrate response size filter by testing random non-existent paths."""
        import random
        import string
        import requests
        
        print("[ffuf] Calibrating response size filter...")
        sizes = []
        words = []
        lines = []
        
        # List of common file extensions to test
        extensions = ['', '.php', '.html', '.js', '.txt']
        
        # Generate 5 random paths to test with different extensions
        for _ in range(5):
            # Generate random string 10-15 chars long
            path_len = random.randint(10, 15)
            random_path = ''.join(random.choices(string.ascii_lowercase + string.digits, k=path_len))
            
            for ext in extensions:
                test_path = random_path + ext
                test_url = self.target_url.rstrip('/') + '/' + test_path
                
                try:
                    # Try with requests first, ignore SSL verification
                    response = requests.get(test_url, timeout=5, verify=False)
                    content_length = len(response.content)
                    word_count = len(response.text.split())
                    line_count = len(response.text.splitlines())
                    
                    sizes.append(content_length)
                    words.append(word_count)
                    lines.append(line_count)
                    
                    print(f"[ffuf] Tested non-existent path: {test_path}")
                    print(f"[ffuf] Response: Size={content_length}, Words={word_count}, Lines={line_count}")
                    
                except requests.RequestException:
                    # Fallback to curl if requests fails, ignore SSL verification
                    try:
                        curl_cmd = ["curl", "-s", "-k", "-o", "/dev/null", 
                                  "-w", "%{size_download},%{num_headers},%{time_total}", 
                                  test_url]
                        output = subprocess.check_output(curl_cmd, timeout=5).decode().strip()
                        size = int(output.split(',')[0])
                        sizes.append(size)
                        print(f"[ffuf] Tested (curl) non-existent path: {test_path}")
                        print(f"[ffuf] Response Size: {size}")
                    except (subprocess.SubprocessError, ValueError) as e:
                        print(f"[ffuf] Curl test failed for {test_path}: {e}")
                        continue
        
        # Calculate the calibrated filters if we got any results
        if sizes or words or lines:
            from collections import Counter
            
            # Calculate most common values
            if sizes:
                self.calibrated_size = Counter(sizes).most_common(1)[0][0]
                print(f"[ffuf] Calibrated size filter (-fs): {self.calibrated_size}")
            
            if words:
                self.calibrated_words = Counter(words).most_common(1)[0][0]
                print(f"[ffuf] Calibrated words filter (-fw): {self.calibrated_words}")
                
            if lines:
                self.calibrated_lines = Counter(lines).most_common(1)[0][0]
                print(f"[ffuf] Calibrated lines filter (-fl): {self.calibrated_lines}")
        else:
            print("[ffuf] Calibration failed, continuing without filters")
            self.calibrated_size = None
            self.calibrated_words = None
            self.calibrated_lines = None

    def prepare_url(self) -> str:
        """Prepare the URL for scanning."""
        if not self.target_url.endswith('/'):
            self.target_url += '/'
        return self.target_url + "FUZZ"

    def build_command(self) -> List[str]:
        """Build the ffuf command with all options."""
        cmd = [
            "ffuf",
            "-u", self.prepare_url(),
            "-w", self.wordlist,
            "-o", self.outfile,
            "-of", "json",
            "-t", str(self.threads),
            "-timeout", str(self.timeout),
            "-maxtime", str(self.max_time),  # Add maximum runtime
            "-mc", "200,204,301,302,307,401,403,405,500",
            "-p", "0.1",
            "-ic"  # Ignore certificate errors for HTTPS
        ]
        
        # Add calibrated filters
        if self.calibrated_size is not None:
            cmd.extend(["-fs", str(self.calibrated_size)])
        if self.calibrated_words is not None:
            cmd.extend(["-fw", str(self.calibrated_words)])
        if self.calibrated_lines is not None:
            cmd.extend(["-fl", str(self.calibrated_lines)])
            
        # Add extensions if specified
        if self.extensions:
            cmd.extend(["-e", ",".join(self.extensions)])

        # Add follow redirects if enabled
        if self.follow_redirects:
            cmd.append("-r")
            
        return cmd
        
    def run(self) -> Dict:
        """Run the ffuf scan and return results as a dictionary"""
        print(f"[ffuf] Directory fuzzing on: {self.prepare_url()}")
        print(f"[ffuf] Using wordlist: {self.wordlist}")
        print(f"[ffuf] Maximum runtime: {self.max_time} seconds")
        
        # Delete any existing output files for this domain
        domain = self.target_url.split('://')[-1].split('/')[0]
        for existing in os.listdir(self.results_dir):
            if existing.startswith(f"ffuf_dirs_{domain}") and existing.endswith('.json'):
                os.remove(os.path.join(self.results_dir, existing))
                print(f"[ffuf] Removed old result file: {existing}")
        
        # Add a warning about SSL verification
        if self.target_url.startswith('https://'):
            print("[ffuf] HTTPS detected - SSL certificate verification will be disabled for calibration")
        
        # Calibrate size filter before running the scan
        self.calibrate_size_filter()
        
        print(f"[ffuf] Output will be saved to: {self.outfile}")
        
        cmd = self.build_command()
        
        # Print the command being executed
        print("[ffuf] Executing command: " + " ".join(cmd))
        
        process = subprocess.Popen(cmd)
        start_time = time.time()

        try:
            while True:
                retcode = process.poll()
                if retcode is not None:
                    break
                
                # Check if we've exceeded max_time
                if time.time() - start_time > self.max_time:
                    print(f"\n[ffuf] Maximum time ({self.max_time}s) reached. Stopping scan...")
                    process.send_signal(signal.SIGINT)
                    break
                    
                time.sleep(0.2)
                
        except KeyboardInterrupt:
            print("\n[ffuf] Ctrl+C detected! Sending SIGINT to ffuf...")
            try:
                process.send_signal(signal.SIGINT)
                for _ in range(25):  # Wait up to 5 seconds
                    if process.poll() is not None:
                        break
                    time.sleep(0.2)
                else:
                    print("\n[ffuf] ffuf didn't exit after 5s, sending SIGKILL...")
                    process.kill()
            except Exception as e:
                print(f"[ffuf] Error during termination: {e}")
                process.kill()
            finally:
                process.wait()

        if os.path.exists(self.outfile):
            with open(self.outfile, 'r') as f:
                data = f.read()
                try:
                    ffuf_data = json.loads(data)
                    
                    # Convert ffuf results to our standard format
                    if "results" in ffuf_data:
                        # Process each result into a standardized finding
                        findings = []
                        for result in ffuf_data["results"]:
                            # Extract the path from the URL
                            url = result.get("url", "")
                            path = url.replace(self.target_url.rstrip('/'), '')
                            if not path.startswith('/'):
                                path = '/' + path
                            
                            # Add standardized finding
                            finding = {
                                "path": path,
                                "url": url,
                                "status": result.get("status", 0),
                                "content-type": result.get("content-type", ""),
                                "length": result.get("length", 0),
                                "words": result.get("words", 0),
                                "lines": result.get("lines", 0),
                                "redirectlocation": result.get("redirectlocation", "")
                            }
                            findings.append(finding)
                        
                        # Return in standardized format
                        return {
                            "target": self.target_url,
                            "time": time.strftime("%Y%m%d-%H%M%S"),
                            "findings": findings
                        }
                    return ffuf_data
                except json.JSONDecodeError:
                    print("[ffuf] Warning: Output is not valid JSON")
                    return {
                        "target": self.target_url,
                        "time": time.strftime("%Y%m%d-%H%M%S"),
                        "findings": []
                    }
        return {
            "target": self.target_url,
            "time": time.strftime("%Y%m%d-%H%M%S"),
            "findings": []
        }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Directory fuzzing tool using ffuf')
    parser.add_argument('url', help='Target URL to scan')
    parser.add_argument('-w', '--wordlist', help='Path to wordlist file')
    parser.add_argument('-e', '--extensions', help='File extensions to check (comma-separated)')
    parser.add_argument('-t', '--threads', type=int, default=40, help='Number of threads (default: 40)')
    parser.add_argument('--timeout', type=int, default=10, help='Request timeout (default: 10)')
    parser.add_argument('--max-time', type=int, default=50, help='Maximum runtime in seconds (default: 30)')
    parser.add_argument('-r', '--follow-redirects', action='store_true', help='Follow redirects')
    
    args = parser.parse_args()
    
    # Convert extensions string to list if provided
    extensions = args.extensions.split(',') if args.extensions else None
    
    # Run the scan with provided arguments
    scanner = FFUFScanner(
        args.url,
        wordlist=args.wordlist,
        extensions=extensions,
        threads=args.threads,
        timeout=args.timeout,
        max_time=args.max_time,
        follow_redirects=args.follow_redirects
    )
    
    # Run and pretty print the results
    result = scanner.run()
    print(json.dumps(result, indent=2))
