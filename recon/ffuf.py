import subprocess
import os
import signal
import time

def run(project_name):
    url = f"http://{project_name}/FUZZ"
    wordlist = "/home/mohammed/tools/SecLists/Passwords/Common-Credentials/10k-most-common.txt"
    outdir = os.path.join("projects", project_name)
    os.makedirs(outdir, exist_ok=True)

    outfile = os.path.join(outdir, "ffuf_dirs.json")
    
    # Handle existing output file
    if os.path.exists(outfile):
        backup = outfile + ".bak"
        print(f"[ffuf] Existing output found. Backing up to: {backup}")
        os.rename(outfile, backup)

    print(f"[ffuf] Directory fuzzing on: {url}")

    cmd = [
        "ffuf",
        "-u", url,
        "-w", wordlist,
        "-o", outfile,
        "-of", "json",
        "-t", "40",
        "-timeout", "10",
        "-mc", "200,204,301,302,307,401,403",
        "-p", "0.1"
    ]

    process = subprocess.Popen(cmd)

    try:
        while True:
            retcode = process.poll()
            if retcode is not None:
                break  # ffuf finished
            time.sleep(0.2)
    except KeyboardInterrupt:
        print("\n[ffuf] Ctrl+C detected! Sending SIGINT to ffuf...")
        try:
            process.send_signal(signal.SIGINT)
            for _ in range(25):  # Wait up to 5 seconds
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

