import subprocess
import os
import json
import xml.etree.ElementTree as ET
from datetime import datetime

def parse_nmap_xml(xml_file):
    """Parse nmap XML output into a dictionary"""
    try:
        tree = ET.parse(xml_file)
        root = tree.getroot()
        results = {
            'scan_info': {},
            'hosts': []
        }
        
        # Get scan information
        results['scan_info'] = {
            'start_time': root.get('start', ''),
            'args': root.get('args', ''),
            'version': root.get('version', '')
        }
        
        # Parse each host
        for host in root.findall('.//host'):
            host_info = {
                'address': host.find('.//address').get('addr', ''),
                'ports': []
            }
            
            # Get port information
            for port in host.findall('.//port'):
                port_info = {
                    'number': port.get('portid', ''),
                    'protocol': port.get('protocol', ''),
                    'state': port.find('state').get('state', '') if port.find('state') is not None else '',
                    'service': {},
                    'scripts': {}
                }
                
                # Get service information
                service = port.find('service')
                if service is not None:
                    port_info['service'] = {
                        'name': service.get('name', ''),
                        'product': service.get('product', ''),
                        'version': service.get('version', ''),
                        'extrainfo': service.get('extrainfo', '')
                    }
                
                # Get script output
                for script in port.findall('.//script'):
                    port_info['scripts'][script.get('id')] = script.get('output', '')
                
                host_info['ports'].append(port_info)
            
            results['hosts'].append(host_info)
        
        return results
    except Exception as e:
        print(f"[nmap_http] Error parsing XML: {str(e)}")
        return None

def run(domain, max_time=300):
    """Run nmap HTTP scan on domain and return results"""
    # Setup directories
    base_dir = os.path.dirname(os.path.dirname(__file__))
    results_dir = os.path.join(base_dir, "results")
    os.makedirs(results_dir, exist_ok=True)
    
    # Generate output filenames
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    xml_output = os.path.join(results_dir, f"nmap_http_{domain}_{timestamp}.xml")
    json_output = os.path.join(results_dir, f"nmap_http_{domain}_{timestamp}.json")

    print(f"\n{'='*60}")
    print(f"[nmap_http] Starting HTTP/HTTPS service scan for {domain}")
    print(f"{'='*60}")
    
    # Build nmap command
    cmd = [
        "nmap",
        "-sV",                # Version detection
        "-Pn",               # Skip host discovery
        "--open",            # Show only open ports
        "-p", "80,443,8080,8443",  # Common web ports
        "--script=http-server-header,http-title,http-headers,http-methods,http-auth,ssl-cert",
        "--script-args=http.useragent='Mozilla/5.0'",
        "-T4",              # Timing template (aggressive)
        "--max-retries", "2",
        "--host-timeout", f"{max_time}s",
        "-oX", xml_output,   # XML output
        domain
    ]
    
    print(f"[nmap_http] Running command: {' '.join(cmd)}")
    
    try:
        # Run nmap
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True
        )
        
        # Monitor output
        while True:
            output = process.stdout.readline()
            if output == '' and process.poll() is not None:
                break
            if output:
                print(output.strip())
        
        # Get return code
        return_code = process.poll()
        
        if return_code == 0:
            print(f"[nmap_http] Scan completed successfully")
            
            # Parse XML output
            results = parse_nmap_xml(xml_output)
            if results:
                # Save results as JSON
                with open(json_output, 'w') as f:
                    json.dump(results, f, indent=2)
                print(f"[nmap_http] Results saved to: {json_output}")
                
                return json.dumps(results)
        else:
            print(f"[nmap_http] Scan failed with return code {return_code}")
            
    except Exception as e:
        print(f"[nmap_http] Error during scan: {str(e)}")
        
    return "{}"

if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        print("Usage: python nmap_http.py <domain>")
        sys.exit(1)
    run(sys.argv[1])
