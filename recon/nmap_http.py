import subprocess
import os

def run(domain):
    outdir = os.path.join("projects", domain)
    os.makedirs(outdir, exist_ok=True)
    xmlout = os.path.join(outdir, "nmap_http.xml")

    # Backup existing output
    if os.path.exists(xmlout):
        bak = xmlout + ".bak"
        print(f"[nmap_http] Backing up existing → {bak}")
        os.replace(xmlout, bak)

    print(f"[nmap_http] HTTP fingerprinting on {domain}…")
    cmd = [
        "nmap",
        "-sV",
        "-p", "80,443",
        "--script=http-server-header,http-title,http-headers",
        "-oX", xmlout,
        domain
    ]
    subprocess.run(cmd, check=True)
    print(f"[nmap_http] Results → {xmlout}")
