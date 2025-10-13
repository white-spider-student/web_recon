import os
import sys
import json
import re
import subprocess
import time
import argparse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Orchestrator: run ffuf_subs, then per-subdomain dirsearch/whatweb/webanalyze,
# then nmap on root and whatweb/webanalyze on root as well.

PROJECT_ROOT = Path(__file__).resolve().parent
SCRIPTS_DIR = PROJECT_ROOT / "recon"
RESULTS_DIR = PROJECT_ROOT / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

def write_file(fname, content):
    p = RESULTS_DIR / fname
    p.write_text(content or "")
    return str(p)

def try_import_and_run(script_path: Path, target, *args, **kwargs):
    """Try to import the module as recon.<name> and call run(target, *args, **kwargs).
    Returns (ok: bool, output: str).
    """
    try:
        # Ensure project root is on sys.path so imports like recon.xxx work
        if str(PROJECT_ROOT) not in sys.path:
            sys.path.insert(0, str(PROJECT_ROOT))

        mod_name = f"recon.{script_path.stem}"
        mod = __import__(mod_name, fromlist=["run"])  # may fail if recon isn't a package
        run_func = getattr(mod, "run", None)
        if not callable(run_func):
            return False, ""
        res = run_func(target, *args, **kwargs)
        if isinstance(res, (bytes, bytearray)):
            res = res.decode(errors="replace")
        elif res is None:
            res = ""
        else:
            res = str(res)
        return True, res
    except Exception:
        return False, ""

def run_subprocess_script(script_path: Path, target, extra_args=None, env_extra=None, timeout=None):
    cmd = [sys.executable, str(script_path), target]
    if extra_args:
        cmd += list(extra_args)
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=timeout)
        out = p.stdout
        if p.stderr:
            out += "\nSTDERR:\n" + p.stderr
        return True, out
    except subprocess.TimeoutExpired as te:
        return False, f"TIMEOUT: {te}"
    except Exception as e:
        return False, f"SUBPROCESS ERROR: {e}"

def extract_subdomains_from_ffuf_json(ffuf_file_text: str, domain: str):
    subs = set()
    try:
        data = json.loads(ffuf_file_text)
        results = data.get("results") if isinstance(data, dict) else None
        if results and isinstance(results, list):
            for item in results:
                if not isinstance(item, dict):
                    continue
                # prefer host field
                host = item.get("host")
                if host:
                    subs.add(str(host).lower().strip("."))
                    continue
                # try url or input
                for key in ("url", "uri", "input"):
                    val = item.get(key)
                    if not val:
                        continue
                    m = re.search(r"https?://([^/]+)", str(val))
                    if m:
                        subs.add(m.group(1).lower().strip("."))
                    else:
                        subs.add(str(val).lower().strip("."))
    except Exception:
        pass

    if not subs:
        pattern = re.compile(r"https?://([a-zA-Z0-9\-_\.]*" + re.escape(domain) + r")", re.IGNORECASE)
        for m in pattern.finditer(ffuf_file_text):
            subs.add(m.group(1).lower().strip("."))

    cleaned = sorted({s for s in subs if s and domain.lower() in s.lower()})
    return cleaned

def locate_ffuf_output(domain: str):
    expected = RESULTS_DIR / f"ffuf_subs_{domain.replace('.', '_')}.json"
    if expected.exists():
        return expected
    matches = list(RESULTS_DIR.glob(f"ffuf_subs_{domain.replace('.', '_')}*.json"))
    return matches[0] if matches else None

def run_tool(tool_name: str, target: str, timeout=None, extra_args=None, filename_label: str = None):
    # Support multiple possible locations for tools:
    # 1) recon/<tool>.py
    # 2) recon/<tool>/<tool>.py (some tools installed in subdir)
    # 3) aliases (e.g. nmap -> nmap_http.py)
    possible_paths = []
    possible_paths.append(SCRIPTS_DIR / f"{tool_name}.py")
    possible_paths.append(SCRIPTS_DIR / tool_name / f"{tool_name}.py")
    # alias mapping
    aliases = {"nmap": "nmap_http.py"}
    if tool_name in aliases:
        possible_paths.append(SCRIPTS_DIR / aliases[tool_name])

    # pick first existing script
    script_path = None
    for p in possible_paths:
        if p.exists():
            script_path = p
            break
    if script_path is None:
        out_fname = f"{tool_name}_{target.replace('/', '_').replace(':','')}.txt"
        write_file(out_fname, f"ERROR: tool {tool_name} not found in recon/\nSearched: {possible_paths}")
        return False, out_fname
    def _sanitize_label(s: str) -> str:
        # keep hostname-like labels compact: replace scheme and non-safe chars
        import re
        # if target looks like a URL, extract hostname
        m = re.search(r"https?://([^/]+)", s)
        if m:
            lbl = m.group(1)
        else:
            lbl = s
        # fallback to provided filename_label if present
        if filename_label:
            lbl = filename_label
        # replace any chars other than alnum, dot, dash, underscore with underscore
        lbl = re.sub(r"[^A-Za-z0-9._-]", "_", lbl)
        return lbl

    # always sanitize target for filenames and URL construction
    clean_target = sanitize_target(target)
    label = _sanitize_label(clean_target)
    out_fname = f"{tool_name}_{label}.json"

    # Prepare execution arguments. For dirsearch we need to pass '-u http://<target>' and
    # prefer running it as a subprocess (dirsearch CLI expects '-u').
    exec_args = list(extra_args) if extra_args else []
    if tool_name == "dirsearch" and not exec_args:
        exec_args = ["-u", f"http://{clean_target}"]

    # If tool is dirsearch, skip attempting to import and run (it expects CLI args)
    if tool_name == "dirsearch":
        ok, out = run_subprocess_script(script_path, clean_target, extra_args=exec_args, env_extra={"RESULTS_DIR": str(RESULTS_DIR)}, timeout=timeout)
        # dirsearch is instructed to write its own JSON output via -o; if it didn't, wrap stdout
        output_path = RESULTS_DIR / out_fname
        if not ok and (RESULTS_DIR / f"dirsearch_{label}.json").exists():
            # prefer dirsearch's own file
            return True, f"dirsearch_{label}.json"
        if out is None:
            out = ""
        write_file(out_fname, out)
        return ok, out_fname

    # Try import & run for other tools
    # For import-run tools, pass sanitized target
    ok, out = try_import_and_run(script_path, clean_target, *(exec_args or []), timeout=timeout)
    if ok:
        write_file(out_fname, out)
        return True, out_fname

    # Fallback to subprocess for non-dirsearch tools
    ok, out = run_subprocess_script(script_path, clean_target, extra_args=exec_args, env_extra={"RESULTS_DIR": str(RESULTS_DIR)}, timeout=timeout)
    # If the tool doesn't natively write JSON, wrap its stdout/stderr into a small JSON object
    if out is None:
        out = ""
    # If tool appears to have already written a JSON file (e.g., whatweb/webanalyze may produce .json), prefer that
    possible_json = RESULTS_DIR / out_fname
    if possible_json.exists() and possible_json.stat().st_size > 0:
        return True, out_fname
    # otherwise, write a JSON wrapper
    wrapper = json.dumps({"tool": tool_name, "target": clean_target, "output": out})
    write_file(out_fname, wrapper)
    return ok, out_fname


def detect_schemes_fast(target: str, timeout=3):
    """Fast TCP connect probe for ports 80 and 443. Returns ['http','https'] as detected."""
    import socket

    schemes = []
    host = target
    # if target is a URL, extract hostname
    m = re.search(r"https?://([^/]+)", target)
    if m:
        host = m.group(1)

    def probe(port: int) -> bool:
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return True
        except Exception:
            return False

    if probe(80):
        schemes.append('http')
    if probe(443):
        schemes.append('https')
    return schemes

def sanitize_target(target: str) -> str:
    """Remove any leading scheme (http:// or https://) and trailing slash from target."""
    if not target:
        return target
    t = target.strip()
    # remove leading scheme
    t = re.sub(r"^https?://", "", t, flags=re.IGNORECASE)
    # remove any leading slashes
    t = re.sub(r"^//+", "", t)
    # remove trailing slash
    if t.endswith('/'):
        t = t.rstrip('/')
    return t

def main():
    parser = argparse.ArgumentParser(description="Orchestrate web recon: ffuf_subs -> dirsearch -> simple_fingerprint -> nmap")
    parser.add_argument("domain", help="Target root domain (example.com)")
    parser.add_argument("--ffuf-max", type=int, default=30, help="Max runtime (s) to give ffuf_subs when importing/running")
    parser.add_argument("--workers", type=int, default=6, help="Number of concurrent workers for per-subdomain tasks")
    args = parser.parse_args()

    domain = args.domain.rstrip("/")
    ffuf_max = args.ffuf_max
    workers = max(1, int(args.workers))

    # Run ffuf_subs (prefer import)
    ffuf_script = SCRIPTS_DIR / "ffuf_subs.py"
    if ffuf_script.exists():
        ok, out = try_import_and_run(ffuf_script, domain, max_time=ffuf_max)
        if ok:
            # write output if ffuf returned raw JSON
            ffuf_out = locate_ffuf_output(domain)
            if not ffuf_out:
                write_file(f"ffuf_subs_{domain.replace('.', '_')}.json", out)
        else:
            # run as subprocess
            run_subprocess_script(ffuf_script, domain, extra_args=[str(ffuf_max)], env_extra={"RESULTS_DIR": str(RESULTS_DIR)}, timeout=ffuf_max + 10)
    else:
        print("[run_all] ffuf_subs.py not found in recon/ - aborting")
        sys.exit(2)

    ffuf_outpath = locate_ffuf_output(domain)
    if not ffuf_outpath:
        print("[run_all] ffuf output not found; ensure ffuf ran and wrote results to results/ffuf_subs_<domain>.json")
        sys.exit(2)

    ffuf_text = ffuf_outpath.read_text()
    subdomains = extract_subdomains_from_ffuf_json(ffuf_text, domain)
    if not subdomains:
        print("[run_all] No subdomains discovered.")
    else:
        print(f"[run_all] Found {len(subdomains)} subdomains. Running per-subdomain scans...")

    # Process per-subdomain work in parallel to speed up large lists.
    def process_subdomain(sd: str):
        """Run dirsearch and simple_fingerprint for a single subdomain."""
        try:
            print(f"[run_all] Processing {sd}")
            clean_sd = sanitize_target(sd)

            # dirsearch: prefer it to write its own JSON file
            output_path = RESULTS_DIR / f"dirsearch_{clean_sd}.json"
            extra_args = ["-u", f"http://{clean_sd}", "-o", str(output_path), "-O", "json"]
            dir_timeout = 1800
            ok, fname = run_tool("dirsearch", sd, timeout=dir_timeout, extra_args=extra_args)
            if not ok and output_path.exists() and output_path.stat().st_size > 0:
                ok = True
                fname = output_path.name
            print(f"  dirsearch -> {fname} (ok={ok})")

            # Fast scheme detection (short timeout) - fallback to both
            schemes = detect_schemes_fast(sd, timeout=2)
            if not schemes:
                schemes = ['http', 'https']
            print(f"  Detected schemes for {sd}: {schemes}")

            # run simple_fingerprint for this subdomain (it handles http/https itself)
            ok2, fname2 = run_tool("simple_fingerprint", clean_sd, timeout=120)
            print(f"  simple_fingerprint -> {fname2} (ok={ok2})")

            return {"subdomain": sd, "dirsearch": (ok, fname), "fingerprint": (ok2, fname2)}
        except Exception as e:
            return {"subdomain": sd, "error": str(e)}

    # Run per-subdomain tasks with a ThreadPoolExecutor
    start = time.time()
    results = []
    if subdomains:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = {ex.submit(process_subdomain, sd): sd for sd in subdomains}
            for fut in as_completed(futures):
                try:
                    r = fut.result()
                except Exception as e:
                    r = {"subdomain": futures.get(fut), "error": str(e)}
                results.append(r)
        elapsed = time.time() - start
        print(f"[run_all] Per-subdomain work completed in {elapsed:.1f}s using {workers} workers")

    # Run nmap on root domain (single, heavier scan)
    ok, fname = run_tool("nmap", domain, timeout=600)
    print(f"[run_all] nmap -> {fname} (ok={ok})")

    # Run simple_fingerprint on root domain as well
    ok, fname = run_tool("simple_fingerprint", domain, timeout=180)
    print(f"[run_all] simple_fingerprint (root) -> {fname} (ok={ok})")

    print(f"[run_all] Done. Results directory: {RESULTS_DIR}")

if __name__ == "__main__":
    main()