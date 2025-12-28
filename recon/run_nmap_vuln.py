#!/usr/bin/env python3
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

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


def _service_string(service_elem):
    if service_elem is None:
        return ""
    name = service_elem.get("name", "") or ""
    product = service_elem.get("product", "") or ""
    version = service_elem.get("version", "") or ""
    extra = service_elem.get("extrainfo", "") or ""
    parts = [p for p in [name, product, version, extra] if p]
    return " ".join(parts).strip()


def _parse_vulners_table(script_elem):
    findings = []
    for table in script_elem.findall("table"):
        key = (table.get("key") or "").strip()
        if not key:
            continue
        elems = {}
        for elem in table.findall("elem"):
            k = elem.get("key") or ""
            elems[k] = (elem.text or "").strip()
        cve = key if key.upper().startswith("CVE-") else elems.get("cve", "") or key
        if not CVE_PATTERN.search(cve):
            continue
        cvss = None
        if "cvss" in elems:
            try:
                cvss = float(elems["cvss"])
            except Exception:
                cvss = None
        url = elems.get("href") or elems.get("url")
        if not url and cve.upper().startswith("CVE-"):
            url = f"https://nvd.nist.gov/vuln/detail/{cve.upper()}"
        findings.append({
            "id": cve.upper(),
            "cvss": cvss,
            "source": "vulners",
            "url": url,
            "raw": elems.get("summary") or ""
        })
    return findings


def _parse_script_output(script_id, output):
    findings = []
    if not output:
        return findings
    cves = set(m.upper() for m in CVE_PATTERN.findall(output))
    for cve in cves:
        cvss = None
        cvss_match = re.search(r"CVSS[:\s]+([0-9.]+)", output, re.IGNORECASE)
        if cvss_match:
            try:
                cvss = float(cvss_match.group(1))
            except Exception:
                cvss = None
        findings.append({
            "id": cve,
            "cvss": cvss,
            "source": script_id or "vuln",
            "url": f"https://nvd.nist.gov/vuln/detail/{cve}",
            "raw": output.strip()
        })
    return findings


def parse_nmap_vuln_xml(xml_path: Path):
    try:
        tree = ET.parse(str(xml_path))
    except Exception as exc:
        print(f"[nmap_vuln] ERROR: failed to parse XML: {exc}")
        return None

    root = tree.getroot()
    hosts = {}
    for host in root.findall("host"):
        addr_elem = host.find("address[@addrtype='ipv4']") or host.find("address")
        addr = addr_elem.get("addr") if addr_elem is not None else None
        hostnames = [h.get("name") for h in host.findall("hostnames/hostname") if h.get("name")]
        if not addr:
            continue
        host_entry = hosts.setdefault(addr, {"ports": {}, "hostnames": hostnames})
        for port in host.findall("ports/port"):
            portid = port.get("portid") or ""
            proto = port.get("protocol") or "tcp"
            port_key = f"{portid}/{proto}"
            service = _service_string(port.find("service"))
            scripts = port.findall("script") or []
            cves = []
            for script in scripts:
                script_id = script.get("id", "")
                output = script.get("output", "") or ""
                if script_id == "vulners":
                    cves.extend(_parse_vulners_table(script))
                if script_id in ("vuln", "vulners") or CVE_PATTERN.search(output or ""):
                    cves.extend(_parse_script_output(script_id, output))
            if cves:
                host_entry["ports"][port_key] = {
                    "service": service,
                    "cves": cves
                }
    return hosts


def run(target: str, mincvss: float = 7.0, max_time: int = 600):
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    CLEAN_DIR.mkdir(parents=True, exist_ok=True)

    label = _sanitize_label(target)
    xml_output = RESULTS_DIR / f"nmap_vuln_{label}.xml"
    json_output = CLEAN_DIR / f"{label}_nmap_vuln.json"

    cmd = [
        "nmap",
        "-sV",
        "--script", "vuln,vulners",
        "--script-args", f"vulners.mincvss={mincvss}",
        "-oX", str(xml_output),
        target
    ]

    print(f"[nmap_vuln] Running: {' '.join(cmd)}")
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=max_time)
        if proc.returncode != 0:
            print(f"[nmap_vuln] WARNING: nmap exited with {proc.returncode}")
            if proc.stderr:
                print(proc.stderr.strip())
    except FileNotFoundError:
        print("[nmap_vuln] ERROR: nmap not found. Skipping.")
        return {}
    except subprocess.TimeoutExpired:
        print("[nmap_vuln] WARNING: nmap scan timed out.")
    except Exception as exc:
        print(f"[nmap_vuln] ERROR: {exc}")

    if not xml_output.exists():
        print("[nmap_vuln] WARNING: XML output not found; skipping parse.")
        return {}

    hosts = parse_nmap_vuln_xml(xml_output)
    payload = {
        "target": target,
        "generatedAt": _utc_now_iso(),
        "hosts": hosts or {}
    }
    json_output.write_text(json.dumps(payload, indent=2))
    print(f"[nmap_vuln] Wrote {json_output}")
    return payload


def main():
    if len(sys.argv) < 2:
        print("Usage: run_nmap_vuln.py <target> [mincvss] [max_time]")
        sys.exit(1)
    target = sys.argv[1]
    mincvss = float(sys.argv[2]) if len(sys.argv) > 2 else 7.0
    max_time = int(sys.argv[3]) if len(sys.argv) > 3 else 600
    run(target, mincvss=mincvss, max_time=max_time)


if __name__ == "__main__":
    main()
