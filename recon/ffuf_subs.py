import os
import subprocess
import signal
import time
import requests

def clean_old_results(domain, results_dir):
    """Remove old results for the given domain"""
    old_file = os.path.join(results_dir, f"ffuf_subs_{domain.replace('.', '_')}.json")
    if os.path.exists(old_file):
        os.remove(old_file)
        print(f"[ffuf] Removed old result file: {old_file}")

def run(domain, max_time=30):
    # Remove any trailing slashes from domain
    domain = domain.rstrip('/')
    
    # Use wordlist from local wordlists directory
    default_wordlist = os.path.join(os.path.dirname(os.path.dirname(__file__)), "wordlists", "bitquark-subdomains-top100000.txt")
    wordlist = os.getenv('SUBDOMAIN_WORDLIST', default_wordlist)
    url = f"http://FUZZ.{domain}"
    
        # Create results directory if it doesn't exist
    results_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "results")
    os.makedirs(results_dir, exist_ok=True)
    
    # Clean up old results
    clean_old_results(domain, results_dir)
    
    # Set output file without timestamp
    outfile = os.path.join(results_dir, f"ffuf_subs_{domain.replace('.', '_')}.json")

    # Calibrate the response size for non-existent subdomains
    print("[ffuf] Calibrating response size for non-existent subdomains...")
    import random
    import string
    import subprocess
    import requests

    # Generate 3 random subdomains to test
    sizes = []
    for _ in range(3):
        random_sub = ''.join(random.choices(string.ascii_lowercase + string.digits, k=10))
        test_url = f"http://{random_sub}.{domain}"
        try:
            response = requests.get(test_url, timeout=5)
            sizes.append(response.headers.get('content-length', '0'))
        except requests.RequestException:
            # If request fails, try to get response size using curl
            curl_cmd = ["curl", "-s", "-o", "/dev/null", "-w", "%{size_download}", test_url]
            try:
                size = subprocess.check_output(curl_cmd, timeout=5).decode().strip()
                sizes.append(size)
            except subprocess.SubprocessError:
                continue

    # Calculate the most common response size
    if sizes:
        from collections import Counter
        calibrated_size = Counter(sizes).most_common(1)[0][0]
        print(f"[ffuf] Calibrated size filter: {calibrated_size}")
    else:
        calibrated_size = None
        print("[ffuf] Calibration failed, continuing without size filter")

    print(f"[ffuf] Using wordlist: {wordlist}")
    print(f"[ffuf] Subdomain fuzzing on: {url}")
    print(f"[ffuf] Maximum runtime: {max_time} seconds")
    print(f"[ffuf] Output will be saved to: {outfile}")

    # Build the ffuf command with calibrated size filter
    cmd = [
        "ffuf",
        "-w", wordlist,
        "-u", url,
        "-mc", "200,204,301,302,307,401,403",
        "-o", outfile,
        "-of", "json",
        "-t", "40",
        "-p", "0.1",
        "-timeout", "10",
        "-maxtime", str(max_time)
    ]
    
    # Add size filter if calibration was successful
    if calibrated_size:
        cmd.extend(["-fs", str(calibrated_size)])

    process = subprocess.Popen(cmd)
    start_time = time.time()

    try:
        while process.poll() is None:
            if time.time() - start_time > max_time:
                print(f"[run_all] Subdomains timed out after {max_time}s (partial results saved)", flush=True)
                try:
                    process.send_signal(signal.SIGINT)
                except Exception:
                    pass
                for _ in range(10):
                    if process.poll() is not None:
                        break
                    time.sleep(0.2)
                else:
                    try:
                        process.kill()
                    except Exception:
                        pass
                break
            time.sleep(0.2)
    except KeyboardInterrupt:
        print("\n[ffuf] Ctrl+C detected! Attempting graceful shutdown...")
        try:
            process.send_signal(signal.SIGINT)
            for _ in range(25):  # Wait up to 5 seconds total
                if process.poll() is not None:
                    break
                time.sleep(0.2)
            else:
                print("[ffuf] Still running... force killing.")
                process.kill()
        except Exception as e:
            print(f"[ffuf] Error during termination: {e}")
        finally:
            process.wait()

    if os.path.exists(outfile):
        with open(outfile, 'r') as f:
            return f.read()
    return "{}"

if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        print("Usage: python3 ffuf_subs.py <domain>")
        sys.exit(1)
    result = run(sys.argv[1])
    print(result)
