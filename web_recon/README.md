# Web Recon Project

This project is designed for web reconnaissance, focusing on subdomain enumeration, directory discovery, and vulnerability analysis. It utilizes various tools and scripts to gather information about a target domain and its subdomains.

## Project Structure

```
web_recon
├── recon
│   ├── ffuf_subs.py        # Script for subdomain enumeration using ffuf
│   ├── dirsearch.py        # Script for directory and endpoint discovery
│   ├── nmap.py             # Script for running nmap scans on the target domain
│   ├── whatweb.py          # Script for identifying web technologies used by a subdomain
│   ├── webanalyze.py       # Script for analyzing web applications for vulnerabilities
│   └── run_all.py          # Main script to orchestrate the entire reconnaissance process
├── wordlists
│   └── bitquark-subdomains-top100000.txt  # Wordlist for subdomain enumeration
├── results
│   └── .gitkeep            # Keeps the results directory tracked by Git
├── requirements.txt        # Lists the Python dependencies required for the project
├── .gitignore              # Specifies files and directories to be ignored by Git
└── README.md               # Documentation for the project
```

## Setup Instructions

1. **Clone the Repository**: 
   Clone this repository to your local machine using:
   ```
   git clone <repository-url>
   ```

2. **Install Dependencies**: 
   Navigate to the project directory and install the required Python packages:
   ```
   pip install -r requirements.txt
   ```

3. **Prepare Wordlists**: 
   Ensure that the wordlist for subdomain enumeration is present in the `wordlists` directory.

4. **Run the Reconnaissance**: 
   Use the `run_all.py` script to start the reconnaissance process. Provide the target domain as an argument:
   ```
   python3 recon/run_all.py <target-domain>
   ```

## Usage Examples

- To scan for subdomains of `example.com`:
  ```
  python3 recon/ffuf_subs.py example.com
  ```

- To discover directories on a specific subdomain:
  ```
  python3 recon/dirsearch.py http://subdomain.example.com
  ```

- To run an nmap scan on the root domain:
  ```
  python3 recon/nmap.py example.com
  ```

- To identify web technologies on a subdomain:
  ```
  python3 recon/whatweb.py http://subdomain.example.com
  ```

- To analyze a web application for vulnerabilities:
  ```
  python3 recon/webanalyze.py http://subdomain.example.com
  ```

## Contributing

Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

## License

This project is licensed under the MIT License. See the LICENSE file for details.