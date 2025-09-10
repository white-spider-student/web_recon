import os
import subprocess
import json
import shutil
from datetime import datetime

def check_webanalyze():
    """Check if webanalyze is installed and accessible"""
    if shutil.which('webanalyze') is None:
        print("[webanalyze] ERROR: `webanalyze` not found!")
        print("[webanalyze] Install instructions:")
        print("  1. Install Go if not already installed")
        print("  2. Run: go install github.com/rverton/webanalyze/cmd/webanalyze@latest")
        return False
    
    # Update technologies database
    print("[webanalyze] Updating technology definitions...")
    try:
        subprocess.run(["webanalyze", "-update"], check=True)
        print("[webanalyze] Technology definitions updated successfully")
    except subprocess.CalledProcessError:
        print("[webanalyze] Error updating technology definitions")
        return False
        
    return True

def run(domain, max_time=60):
    """Run webanalyze scan on domain and return results"""
    if not check_webanalyze():
        return "{}"
        
    # Setup directories
    base_dir = os.path.dirname(os.path.dirname(__file__))
    results_dir = os.path.join(base_dir, "results")
    os.makedirs(results_dir, exist_ok=True)
    
    # Generate output filename
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    json_output = os.path.join(results_dir, f"webanalyze_{domain}_{timestamp}.json")

    print(f"\n{'='*60}")
    print(f"[webanalyze] Starting technology fingerprinting for {domain}")
    print(f"{'='*60}")

    all_results = []
    
    # Scan both HTTP and HTTPS
    for protocol in ['http', 'https']:
        url = f"{protocol}://{domain}"
        cmd = [
            "webanalyze",
            "-host", url,
            "-crawl", "2",          # Crawl depth of 2
            "-output", "json",
            "-worker", "10",        # Number of worker threads
            "-silent"               # Avoid printing header
        ]
        
        print(f"[webanalyze] Scanning {url}")
        try:
            # Run webanalyze
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                universal_newlines=True
            )
            
            # Get output
            stdout, stderr = process.communicate(timeout=max_time)
            
            if process.returncode == 0 and stdout:
                try:
                    scan_results = json.loads(stdout)
                    if isinstance(scan_results, list):
                        all_results.extend(scan_results)
                    else:
                        all_results.append(scan_results)
                    print(f"[webanalyze] Successfully scanned {url}")
                except json.JSONDecodeError:
                    print(f"[webanalyze] Error parsing JSON output for {url}")
            else:
                print(f"[webanalyze] Scan failed for {url}")
                if stderr:
                    print(f"[webanalyze] Error: {stderr}")
                    
        except subprocess.TimeoutExpired:
            print(f"[webanalyze] Scan timed out for {url}")
            process.kill()
        except Exception as e:
            print(f"[webanalyze] Error scanning {url}: {str(e)}")
    
    # Save combined results
    if all_results:
        try:
            with open(json_output, 'w') as f:
                json.dump(all_results, f, indent=2)
            print(f"[webanalyze] Results saved to: {json_output}")
            return json.dumps(all_results)
        except Exception as e:
            print(f"[webanalyze] Error saving results: {str(e)}")
    
    return "[]"

if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        print("Usage: python webanalyze.py <domain>")
        sys.exit(1)
    run(sys.argv[1])

