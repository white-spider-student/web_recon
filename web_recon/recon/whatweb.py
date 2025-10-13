import os
import subprocess
import sys

def run_whatweb(url):
    cmd = ["whatweb", url]
    try:
        result = subprocess.check_output(cmd, stderr=subprocess.STDOUT).decode()
        return result
    except subprocess.CalledProcessError as e:
        print(f"[whatweb] Error running whatweb on {url}: {e.output.decode()}")
        return ""

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 whatweb.py <url>")
        sys.exit(1)
    
    url = sys.argv[1]
    result = run_whatweb(url)
    
    results_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "results")
    output_file = os.path.join(results_dir, f"whatweb_{url.replace('.', '_')}.txt")
    
    with open(output_file, 'w') as f:
        f.write(result)
    
    print(f"[whatweb] Results saved to: {output_file}")