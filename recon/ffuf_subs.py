import os
import subprocess
import signal
import time

def run(domain):
    outdir = os.path.join("projects", domain)
    os.makedirs(outdir, exist_ok=True)

    wordlist = "/home/mohammed/tools/SecLists/Discovery/DNS/subdomains-top1million-5000.txt"
    url = f"http://FUZZ.{domain}"
    outfile = os.path.join(outdir, "ffuf_subs.json")

    print(f"[ffuf] Subdomain fuzzing on: {url}")

    cmd = [
        "ffuf",
        "-w", wordlist,
        "-u", url,
        "-mc", "200,204,301,302,307,401,403",
        "-o", outfile,
        "-of", "json",
        "-t", "40",
        "-p", "0.1"
    ]

    process = subprocess.Popen(cmd)

    try:
        while process.poll() is None:
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

    if os.path.exists(outfile) and os.path.getsize(outfile) > 0:
        print(f"[ffuf] Output saved: {outfile}")
    else:
        print("[ffuf] No output file was created or it's empty.")

    return  # Back to shell

