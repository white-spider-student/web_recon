# Security Policy

## Supported Versions
This project is maintained as a single active version. Update to the latest commit before reporting issues.

## Reporting a Vulnerability
Please report security issues privately and do not open public issues.

Send a report with:
- A clear description of the issue
- Steps to reproduce
- Impact assessment (what can be accessed or executed)
- Any relevant logs or screenshots

If you need a contact, open a minimal private message to the project owner with the subject “Security report”.

## Configuration Expectations
- Run the API on a trusted network segment.
- Configure `CORS_ORIGINS` to specific origins.
- Avoid running Puppeteer with `PDF_ALLOW_NO_SANDBOX=true` unless required by your environment.
