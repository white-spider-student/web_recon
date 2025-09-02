# modules/recon/webanalyze.py

import os
import subprocess

def run(domain):
    outdir = os.path.join("projects", domain)
    os.makedirs(outdir, exist_ok=True)

    outfile = os.path.join(outdir, "webanalyze.json")
    # Backup old output if present
    if os.path.exists(outfile):
        bak = outfile + ".bak"
        print(f"[webanalyze] Backing up existing → {bak}")
        os.replace(outfile, bak)

    print(f"[webanalyze] Running technology fingerprint on {domain}…")
    cmd = [
        "webanalyze",
        "-host", f"http://{domain}",
        "-output", "json"
    ]

    try:
        with open(outfile, "w") as f:
            subprocess.run(cmd, stdout=f, check=True)
        print(f"[webanalyze] Results saved → {outfile}")
    except FileNotFoundError:
        print("[webanalyze] ERROR: `webanalyze` not found; please install it with Go and add it to your PATH.")
    except subprocess.CalledProcessError as e:
        print(f"[webanalyze] ERROR: scan failed: {e}")

