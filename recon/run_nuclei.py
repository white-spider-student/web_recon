#!/usr/bin/env python3
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RESULTS_DIR = PROJECT_ROOT / "results"
CLEAN_DIR = RESULTS_DIR / "clean"

CVE_PATTERN = re.compile(r"CVE-\d{4}-\d{4,7}", re.IGNORECASE)


def _utc_now_iso():
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _sanitize_label(value: str) -> str:
    if not value:
        return "target"
    return re.sub(r"[^A-Za-z0-9._-]", "_", value.strip())


def _normalize_url(raw: str) -> str:
    try:
        parsed = urlparse(raw.strip())
        if not parsed.scheme or not parsed.hostname:
            return ""
        host = parsed.hostname.lower()
        port = parsed.port
        scheme = parsed.scheme.lower()
        if port is None:
            port = 443 if scheme == "https" else 80
        return f"{scheme}://{host}:{port}"
    except Exception:
        return ""


def _parse_jsonl(lines):
    findings = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except Exception:
            continue
        info = payload.get("info", {}) if isinstance(payload.get("info"), dict) else {}
        template_id = payload.get("template-id") or payload.get("templateID") or payload.get("template") or ""
        matched_at = payload.get("matched-at") or payload.get("matched_at") or payload.get("host") or ""
        refs = info.get("reference") or payload.get("reference") or []
        if isinstance(refs, str):
            refs = [refs]
        cve = None
        if template_id:
            m = CVE_PATTERN.search(template_id)
            if m:
                cve = m.group(0).upper()
        finding = {
            "url": matched_at,
            "template": template_id,
            "cve": cve,
            "severity": (info.get("severity") or payload.get("severity") or "").lower(),
            "name": info.get("name") or payload.get("name") or "",
            "refs": refs,
            "timestamp": payload.get("timestamp") or payload.get("time")
        }
        findings.append(finding)
    return findings


def run(target: str, urls, severities=None, templates=None, update_templates=False, max_time=600):
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    CLEAN_DIR.mkdir(parents=True, exist_ok=True)

    if not shutil.which("nuclei"):
        print("[nuclei] WARNING: nuclei not installed; skipping nuclei scan.")
        return {"target": target, "generatedAt": _utc_now_iso(), "findings": []}

    label = _sanitize_label(target)
    jsonl_output = RESULTS_DIR / f"nuclei_{label}.jsonl"
    clean_output = CLEAN_DIR / f"{label}_nuclei.json"

    if jsonl_output.exists():
        jsonl_output.unlink()

    sev = ",".join(severities) if severities else "medium,high,critical"
    urls = [u for u in urls if _normalize_url(u)]
    urls = sorted(set(urls))

    if update_templates:
        try:
            print("[nuclei] Updating templates...")
            subprocess.run(["nuclei", "-update-templates"], check=False)
        except Exception as exc:
            print(f"[nuclei] WARNING: template update failed: {exc}")

    for url in urls:
        cmd = ["nuclei", "-u", url, "-json", "-severity", sev]
        if templates:
            cmd += ["-t", templates]
        print(f"[nuclei] Running: {' '.join(cmd)}")
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=max_time)
            if proc.stdout:
                with jsonl_output.open("a", encoding="utf-8") as fh:
                    fh.write(proc.stdout)
                    if not proc.stdout.endswith("\n"):
                        fh.write("\n")
            if proc.returncode != 0 and proc.stderr:
                print(proc.stderr.strip())
        except subprocess.TimeoutExpired:
            print(f"[nuclei] WARNING: nuclei timed out for {url}")
        except Exception as exc:
            print(f"[nuclei] WARNING: nuclei failed for {url}: {exc}")

    findings = []
    if jsonl_output.exists():
        findings = _parse_jsonl(jsonl_output.read_text().splitlines())

    payload = {
        "target": target,
        "generatedAt": _utc_now_iso(),
        "findings": findings
    }
    clean_output.write_text(json.dumps(payload, indent=2))
    print(f"[nuclei] Wrote {clean_output}")
    return payload


def main():
    if len(sys.argv) < 3:
        print("Usage: run_nuclei.py <target> <urls_file> [severities] [templates] [update_templates]")
        sys.exit(1)
    target = sys.argv[1]
    urls_file = Path(sys.argv[2])
    severities = sys.argv[3].split(",") if len(sys.argv) > 3 and sys.argv[3] else None
    templates = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else None
    update_templates = bool(int(sys.argv[5])) if len(sys.argv) > 5 else False
    if not urls_file.exists():
        print(f"[nuclei] ERROR: urls file not found: {urls_file}")
        sys.exit(2)
    urls = [l.strip() for l in urls_file.read_text().splitlines() if l.strip()]
    run(target, urls, severities=severities, templates=templates, update_templates=update_templates)


if __name__ == "__main__":
    main()
