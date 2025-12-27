import os
import sys
import json
import re
import subprocess
import time
import argparse
import sqlite3
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Orchestrator: run ffuf_subs, then per-subdomain dirsearch/whatweb/webanalyze,
# then nmap on root and whatweb/webanalyze on root as well.

PROJECT_ROOT = Path(__file__).resolve().parent
SCRIPTS_DIR = PROJECT_ROOT / "recon"
RESULTS_DIR = PROJECT_ROOT / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = PROJECT_ROOT / "server" / "data.db"

def write_file(fname, content):
    p = RESULTS_DIR / fname
    p.write_text(content or "")
    return str(p)

def _utc_now_iso():
    return datetime.utcnow().isoformat(timespec='seconds') + 'Z'

def _ensure_website_row(db, website_url: str):
    cur = db.cursor()
    cur.execute('SELECT id FROM websites WHERE url = ? LIMIT 1', (website_url,))
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute('INSERT INTO websites (url, name) VALUES (?, ?)', (website_url, website_url))
    return cur.lastrowid

def record_scan_timestamp(website_url: str, started: bool = False, finished: bool = False):
    if not website_url:
        return None
    ts = _utc_now_iso()
    try:
        if not DB_PATH.exists():
            print(f"[run_all] WARNING: DB not found at {DB_PATH}; skipping scan timestamp")
            return None
        db = sqlite3.connect(str(DB_PATH))
        cur = db.cursor()
        cur.execute("PRAGMA table_info('websites')")
        cols = [c[1] for c in cur.fetchall()] if cur else []
        if 'scan_started_at' not in cols or 'scan_finished_at' not in cols:
            print("[run_all] WARNING: websites scan timestamp columns missing; skipping timestamp update")
            db.close()
            return None
        _ensure_website_row(db, website_url)
        if started:
            db.execute('UPDATE websites SET scan_started_at = ? WHERE url = ?', (ts, website_url))
            print(f"[run_all] Scan started at {ts}")
        if finished:
            db.execute('UPDATE websites SET scan_finished_at = ? WHERE url = ?', (ts, website_url))
            print(f"[run_all] Scan finished at {ts}")
        db.commit()
        db.close()
        return ts
    except Exception as e:
        print(f"[run_all] WARNING: failed to record scan timestamp: {e}")
        return None

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

    record_scan_timestamp(domain, started=True)
    try:
        # Always start with a clean results directory to avoid stale outputs between runs
        try:
            import shutil
            if RESULTS_DIR.exists():
                print(f"[run_all] Cleaning previous results under {RESULTS_DIR} ...")
                shutil.rmtree(RESULTS_DIR, ignore_errors=True)
            RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            print(f"[run_all] WARNING: failed to fully clean results dir: {e}")

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

        # Optional: augment subdomains by crawling root homepage for linked subdomains
        try:
            ok, html_json_fname = run_tool("html_link_discovery", domain, timeout=90)
            print(f"[run_all] html_link_discovery(root) -> {html_json_fname} (ok={ok})")
            try:
                # The html_link_discovery tool may have written the real discovery file as
                # results/html_links_<label>.json while run_tool returned a wrapper file
                # (html_link_discovery_<label>.json) containing stdout. Try several
                # candidate paths and extract the real discovery object.
                actual_html_path = None
                candidates = []
                # the file returned by run_tool may be a wrapper filename
                try:
                    if html_json_fname:
                        candidates.append(RESULTS_DIR / html_json_fname)
                except Exception:
                    pass
                # common html_links file pattern
                candidates.append(RESULTS_DIR / f"html_links_{domain.replace('.', '_')}.json")
                # glob any html_links file that contains the domain fragment
                candidates.extend(list(RESULTS_DIR.glob(f"html_links_*{domain.replace('.', '_')}*.json")))

                data = None
                for c in candidates:
                    try:
                        if not c.exists():
                            continue
                        raw = json.loads(c.read_text())
                        # if this JSON already contains the discovery keys, use it
                        if isinstance(raw, dict) and raw.get('discovered'):
                            data = raw
                            actual_html_path = c
                            break
                        # some wrappers store the crawler stdout under 'output'
                        if isinstance(raw, dict) and isinstance(raw.get('output'), str):
                            try:
                                inner = json.loads(raw.get('output'))
                                if isinstance(inner, dict) and inner.get('discovered'):
                                    data = inner
                                    actual_html_path = c
                                    break
                            except Exception:
                                pass
                        # some other wrappers may embed the payload under different keys
                        # fall back to using the raw object if it looks like discovery
                        if isinstance(raw, dict) and (raw.get('discovered') is not None):
                            data = raw
                            actual_html_path = c
                            break
                    except Exception:
                        continue

                if data is None:
                    # final fallback: try to read the original file directly and parse
                    try:
                        candidate = RESULTS_DIR / html_json_fname
                        if candidate.exists():
                            data = json.loads(candidate.read_text())
                            actual_html_path = candidate
                    except Exception:
                        data = None

                if data is None:
                    raise ValueError('could not locate html_link_discovery discovery JSON')

                linked_subs = [s for s in data.get("discovered", {}).get("subdomains", []) if s.endswith(domain)]
                # Show discovered URLs from the website to help verify crawling
                discovered_urls = data.get("discovered", {}).get("urls", []) or []
                if discovered_urls:
                    print(f"[run_all] Discovered {len(discovered_urls)} URLs from HTML crawling:")
                    # Print a limited preview to keep logs readable
                    preview_count = min(30, len(discovered_urls))
                    for u in discovered_urls[:preview_count]:
                        print(f"    - {u}")
                    if len(discovered_urls) > preview_count:
                        print(f"    ... and {len(discovered_urls) - preview_count} more")
                if linked_subs:
                    before = set(subdomains)
                    subdomains = sorted(list(before.union(linked_subs)))
                    print(f"[run_all] Added {len(set(linked_subs)-before)} subdomains from HTML links")
                # Import discovered endpoints/directories into the database for visualization
                try:
                    importer = PROJECT_ROOT / 'recon' / 'import_html_links.py'
                    if importer.exists():
                        # Use website URL equal to the domain string (frontend expects this mapping)
                        imp_arg = str(actual_html_path) if actual_html_path is not None else str(RESULTS_DIR / html_json_fname)
                        ok_imp, out_imp = run_subprocess_script(importer, domain, extra_args=[imp_arg])
                        print(f"[run_all] import_html_links -> {out_imp[:180]}...")
                        # Also produce a hierarchical visualization JSON for the frontend
                        try:
                            viz_script = PROJECT_ROOT / 'scripts' / 'build_hierarchical_json.py'
                            if viz_script.exists():
                                viz_out = RESULTS_DIR / 'clean' / f"{domain}_viz.json"
                                viz_in = imp_arg
                                ok_viz, out_viz = run_subprocess_script(viz_script, viz_in, extra_args=[str(viz_out)])
                                msg = out_viz if isinstance(out_viz, str) else str(out_viz)
                                print(f"[run_all] build_hierarchical_json -> {msg[:180]}...")
                            else:
                                print("[run_all] build_hierarchical_json.py not found; skipping viz JSON generation")
                        except Exception as viz_err:
                            print(f"[run_all] build_hierarchical_json error: {viz_err}")
                    else:
                        print("[run_all] import_html_links.py not found; skip DB import of discovered URLs")
                except Exception as imp_err:
                    print(f"[run_all] import_html_links error: {imp_err}")
            except Exception as e:
                print(f"[run_all] failed to read html_link_discovery output: {e}")
        except Exception as e:
            print(f"[run_all] html_link_discovery error: {e}")

        # Process per-subdomain work in parallel to speed up large lists.
        def process_subdomain(sd: str):
            """Run dirsearch and simple_fingerprint for a single subdomain."""
            try:
                print(f"[run_all] Processing {sd}")
                clean_sd = sanitize_target(sd)

                # dirsearch: prefer it to write its own JSON file
                output_path = RESULTS_DIR / f"dirsearch_{clean_sd}.json"
                extra_args = ["-u", f"http://{clean_sd}", "-o", str(output_path), "--format=json"]
                dir_timeout = 1800
                ok, fname = run_tool("dirsearch", sd, timeout=dir_timeout, extra_args=extra_args)
                if output_path.exists() and output_path.stat().st_size > 0:
                    try:
                        _ = json.loads(output_path.read_text())
                        ok = True
                        fname = output_path.name
                    except Exception:
                        pass
                print(f"  dirsearch -> {fname} (ok={ok})")

                # Import dirsearch results into the DB for visualization if available
                try:
                    if ok and fname:
                        dir_json = RESULTS_DIR / fname
                        if dir_json.exists() and dir_json.stat().st_size > 0:
                            importer = PROJECT_ROOT / 'recon' / 'import_dirsearch.py'
                            if importer.exists():
                                ok_imp, out_imp = run_subprocess_script(importer, domain, extra_args=[clean_sd, str(dir_json)])
                                # Trim output to reasonable length in logs
                                msg = out_imp if isinstance(out_imp, str) else str(out_imp)
                                print(f"  import_dirsearch -> {msg[:180]}...")
                            else:
                                print("  import_dirsearch.py not found; skipping DB import for dirsearch")
                except Exception as imp_e:
                    print(f"  import_dirsearch error: {imp_e}")

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
    finally:
        record_scan_timestamp(domain, finished=True)
if __name__ == "__main__":
    main()
