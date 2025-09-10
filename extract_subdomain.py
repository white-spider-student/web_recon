import json
import sys
from urllib.parse import urlparse

def extract_domains(ffuf_json_file):
    with open(ffuf_json_file, "r") as f:
        data = json.load(f)

    results = data.get("results", [])
    if not results:
        print("No results found in the ffuf JSON file.")
        return

    # Get base domain from ffuf config
    base_url = data.get("config", {}).get("url", "")
    parsed_base = urlparse(base_url.replace("FUZZ.", ""))
    base_domain = parsed_base.netloc if parsed_base.netloc else parsed_base.path

    print(f"\nMain domain: {base_domain}")
    print("Discovered subdomains:")

    subdomains = set()
    for entry in results:
        host = entry.get("host")
        if host and host not in subdomains:
            subdomains.add(host)
            print(f" - {host}")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: python {sys.argv[0]} ffuf_results.json")
        sys.exit(1)

    extract_domains(sys.argv[1])
