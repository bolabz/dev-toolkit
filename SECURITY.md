# Security Policy

## Reporting a Vulnerability

If you believe you have found a security vulnerability in this project,
**please do not open a public issue or pull request**. Public disclosure of
an unpatched vulnerability puts every user of this project at risk.

Instead, report it privately through GitHub's [Private Vulnerability
Reporting](https://github.com/bolabz/dev-toolkit/security/advisories/new)
form for this repository. Reports submitted through this channel are visible
only to the maintainer.

If GitHub Private Vulnerability Reporting is unavailable to you, you may
contact the maintainer through the [GitHub
profile](https://github.com/AaronBoehle) instead.

When reporting, please include:

- A description of the vulnerability and its impact.
- The affected version (commit SHA or release tag).
- Reproduction steps or a proof of concept.
- Any suggested mitigation, if known.

You can expect:

- An acknowledgement within **3 business days**.
- A triage decision and target fix window within **10 business days**.
- A coordinated disclosure once a fix is released.

## Supported Versions

Only the latest commit on the `main` branch receives security updates. This
project is currently published as a personal portfolio artifact and is **not
intended for production use** — see `LICENSE` for terms.

## Threat Model

This toolkit operates against a user's own Google Gmail account using OAuth
2.0 with the `gmail.modify`, `gmail.compose`, and `gmail.settings.basic`
scopes. The threat surfaces considered in design are:

| Surface                                                              | Mitigation                                                                                                                                               |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAuth credentials on disk (`credentials.json`, `token.json`)         | gitignored; token written with `0600` file permissions; refresh token never logged                                                                       |
| OAuth callback server (`http://127.0.0.1:3000/oauth2callback`)       | Bound to loopback only; CSRF-protected via random `state`; auto-shutdown after one redirect or 2-minute timeout                                          |
| HTML rendered to user's browser after OAuth                          | All untrusted strings (`message`) HTML-escaped before interpolation                                                                                      |
| Email body content flowing through `html-to-text` to MCP tool output | Treated as untrusted; **prompt injection from email senders is a known limitation of LLM-driven email tools and is the user's responsibility to review** |
| Gmail API quota exhaustion / DoS                                     | Rate limiting via `p-queue`, exponential backoff on 429/5xx responses                                                                                    |
| Dependency supply chain                                              | Dependabot enabled; npm audit gated in CI; secret-scanning push protection enabled on the repository                                                     |

If you discover a surface not covered here, that itself is a finding worth
reporting.
