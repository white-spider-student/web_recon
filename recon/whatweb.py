import subprocess
import os
import json
from datetime import datetime

def run(domain, max_time=60):
    """Run WhatWeb scan on a domain and return results"""
    # Setup directories
    base_dir = os.path.dirname(os.path.dirname(__file__))
    results_dir = os.path.join(base_dir, "results")
    os.makedirs(results_dir, exist_ok=True)
    
    # Generate output filename
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    json_output = os.path.join(results_dir, f"whatweb_{domain}_{timestamp}.json")

    print(f"\n{'='*60}")
    print(f"[whatweb] Starting web technology scan for {domain}")
    print(f"{'='*60}")

    # Build whatweb commands for both http and https
    results = []
    for protocol in ['http', 'https']:
        url = f"{protocol}://{domain}"
        # Create a temporary file for JSON output
        temp_json = os.path.join(results_dir, f"temp_{timestamp}.json")
        
        cmd = [
            "whatweb",
            "--no-errors",           # Don't show errors
            "--color=never",         # No color output
            "-a", "3",              # Aggression level
            "--wait=3",             # Wait between requests
            "--user-agent", "Mozilla/5.0",
            "--log-json", temp_json,  # Output JSON to file
            url
        ]
        
        print(f"[whatweb] Scanning {url}")
        try:
            # Run whatweb
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                universal_newlines=True
            )
            
            # Get output
            stdout, stderr = process.communicate(timeout=max_time)
            
            if process.returncode == 0:
                try:
                    # Read the JSON output from the temp file
                    if os.path.exists(temp_json):
                        with open(temp_json, 'r') as f:
                            scan_results = json.load(f)
                            results.extend(scan_results)
                            print(f"[whatweb] Successfully scanned {url}")
                        os.remove(temp_json)  # Clean up temp file
                    else:
                        print(f"[whatweb] No output file found for {url}")
                except json.JSONDecodeError as e:
                    print(f"[whatweb] Error parsing JSON output for {url}: {str(e)}")
                except Exception as e:
                    print(f"[whatweb] Error reading results for {url}: {str(e)}")
            else:
                print(f"[whatweb] Scan failed for {url}")
                if stderr:
                    print(f"[whatweb] Error: {stderr}")
                if stdout:
                    print(f"[whatweb] Output: {stdout}")
                    
        except subprocess.TimeoutExpired:
            print(f"[whatweb] Scan timed out for {url}")
            process.kill()
        except Exception as e:
            print(f"[whatweb] Error scanning {url}: {str(e)}")
    
    # Save combined results
    if results:
        try:
            with open(json_output, 'w') as f:
                json.dump(results, f, indent=2)
            print(f"[whatweb] Results saved to: {json_output}")
            return json.dumps(results)
        except Exception as e:
            print(f"[whatweb] Error saving results: {str(e)}")
    
    return "[]"

if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        print("Usage: python whatweb.py <domain>")
        sys.exit(1)
    run(sys.argv[1])
