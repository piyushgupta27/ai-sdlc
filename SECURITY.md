# Security Policy

## Supported Versions

ai-sdlc is in early development. Only the `main` branch receives security fixes. Tagged releases will be supported per a published policy once v1.0 ships.

## Reporting a Vulnerability

**Please do not file public issues for security vulnerabilities.**

Report security issues privately to:

- **Email:** piyushguptaece@gmail.com
- **Subject line:** `[ai-sdlc security]` followed by a short description

Include in your report:

1. **Description** of the vulnerability
2. **Reproduction steps** (proof-of-concept code, configuration, or commands)
3. **Impact assessment** (what an attacker could achieve)
4. **Affected versions / commits** if known
5. **Suggested fix** (optional, but appreciated)

## Response timeline

| Stage | Target |
|---|---|
| Acknowledgement of report | Within 7 days |
| Initial assessment + severity classification | Within 14 days |
| Fix planning + disclosure timeline shared with reporter | Within 30 days |
| Public disclosure (coordinated with reporter) | 90 days from initial report, or sooner if fix lands |

These are best-effort targets for a personally maintained project. Critical issues that affect runtime safety or data integrity are prioritized over feature work.

## Disclosure approach

ai-sdlc follows a **coordinated disclosure** model:

1. Reporter sends private report
2. Maintainer acknowledges + investigates
3. Fix is developed in a private branch (or via a private security advisory on GitHub)
4. Reporter is credited (unless they request anonymity) in the public advisory
5. Fix lands in `main` + a security advisory is published simultaneously

If a reporter wishes to publish independently before a fix is available, we ask for 90 days advance notice. We will not pursue legal action against good-faith security researchers who follow this process.

## Scope

In scope:

- Code in this repository
- Default configurations and example workflows
- Documentation that leads users into insecure practices

Out of scope:

- Vulnerabilities in dependencies (report those to the upstream project; we will track and update)
- Issues that require physical access to the host running ai-sdlc
- Social-engineering attacks on the maintainer or contributors
- Theoretical issues without demonstrable exploit

## Recognition

Contributors who follow this process are acknowledged in the project's `SECURITY-ACKNOWLEDGEMENTS.md` (created when the first valid report lands) and in the relevant CVE / advisory text.
