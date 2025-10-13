import os
import subprocess
import sys

def run_nmap(domain, output_file):
    cmd = ["nmap", "-sV", domain, "-oN", output_file]
    subprocess.run(cmd)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 nmap.py <domain>")
        sys.exit(1)
    
    domain = sys.argv[1]
    results_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "results")
    output_file = os.path.join(results_dir, f"nmap_{domain.replace('.', '_')}.txt")
    
    run_nmap(domain, output_file)
    print(f"Nmap scan results saved to: {output_file}")