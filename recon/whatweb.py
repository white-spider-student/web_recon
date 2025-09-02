import subprocess
import os

def run(domain):
    outdir = os.path.join("projects", domain)
    os.makedirs(outdir, exist_ok=True)
    outfile = os.path.join(outdir, "whatweb.json")

    # Backup existing output
    if os.path.exists(outfile):
        bak = outfile + ".bak"
        print(f"[whatweb] Backing up existing → {bak}")
        os.replace(outfile, bak)

    print(f"[whatweb] Fingerprinting {domain}…")
    cmd = [
        "whatweb",
        f"http://{domain}",
        "-v",
        "--log-json",
        outfile
    ]
    subprocess.run(cmd, check=True)
    print(f"[whatweb] Results → {outfile}")
