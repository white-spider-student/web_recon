import os
import subprocess

def run_dirsearch(subdomain):
    """Run dirsearch on the given subdomain and save results."""
    url = f"http://{subdomain}"
    results_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "results")
    outfile = os.path.join(results_dir, f"dirsearch_{subdomain.replace('.', '_')}.json")

    cmd = [
        "python3", "dirsearch.py",
        "-u", url,
        "-o", outfile,
        "-f",  # Follow redirects
        "-t", "40",  # Number of threads
        "-r",  # Recursive
        "-e", "php,html,js",  # File extensions to search for
    ]

    subprocess.run(cmd)

if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        print("Usage: python3 dirsearch.py <subdomain>")
        sys.exit(1)
    run_dirsearch(sys.argv[1])