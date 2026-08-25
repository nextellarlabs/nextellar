# Security Audit & Dependency Management

## Overview

Nextellar uses automated CI/CD workflows to continuously audit dependencies and enforce security policies. This document explains how our security processes work and how to contribute securely.

## Automated Security Scanning

### CI Workflows

Three GitHub Actions workflows handle security:

#### 1. **Dependency Audit** (`.github/workflows/audit.yml`)

**When it runs:**
- On every push to `main` and `develop`
- On every pull request modifying `package.json`
- Daily at 2 AM UTC
- Manual trigger via workflow dispatch

**What it does:**
- Runs `npm audit` with severity filtering
- Checks for vulnerable transitive dependencies
- Runs CodeQL static analysis
- Comments on PRs with vulnerability summary
- Uploads JSON reports as artifacts
- Enforces severity gates (see below)

**Severity Gates:**

| Severity | Action | Builds |
|----------|--------|--------|
| **Critical** | ❌ Block merge | Fail |
| **High** | ❌ Block merge | Fail |
| **Moderate** | ⚠️ Allow merge, 30-day remediation | Warn |
| **Low** | ℹ️ Log for tracking | Pass |

#### 2. **Dependency Updates** (`.github/workflows/dependencies.yml`)

**When it runs:**
- On pull requests with dependency changes
- Validates updates work correctly
- Adds comments with guidelines
- Auto-merges security-related updates from Dependabot

#### 3. **Dependabot Configuration** (`.github/dependabot.yml`)

**Automated updates for:**
- NPM dependencies (weekly, Monday 3 AM UTC)
- GitHub Actions (weekly, Monday 4 AM UTC)
- Dev dependencies grouped separately
- Security updates merged automatically
- Manual review required for feature updates

## Running Audits Locally

### Quick Audit

```bash
# Check for moderate and higher severity issues
npm run audit

# See output as JSON
npm run audit:strict
```

### Fix Vulnerabilities

```bash
# Automatically fix fixable vulnerabilities
npm audit fix

# Review changes before committing
git diff package.json
```

### Detailed Analysis

```bash
# Generate full audit report
npm audit --json > audit-report.json

# View report
cat audit-report.json | jq '.vulnerabilities'
```

## Security Policy

See [SECURITY.md](../SECURITY.md) for complete policy details including:

- Severity level definitions
- Remediation timelines
- Incident response procedures
- License approval process
- Responsible disclosure

### Key Policies

1. **Zero tolerance for critical vulnerabilities**
   - Must be fixed within 24 hours
   - Blocks all merges
   - Automatic issue creation

2. **High severity within 7 days**
   - Blocks merges
   - Requires immediate triage

3. **Moderate severity within 30 days**
   - Allows merge with warning
   - Tracked in issues with due dates

4. **Low severity ongoing**
   - Monitored in quarterly reviews
   - Fixed during regular maintenance

## Common Scenarios

### "npm audit found 5 vulnerabilities"

1. **Check severity:**
   ```bash
   npm audit | grep "severity"
   ```

2. **If critical/high:**
   - Stop work on feature branch
   - Create emergency fix branch
   - Run `npm audit fix`
   - Test thoroughly
   - Create PR with label `security`
   - Fast-track to main

3. **If moderate/low:**
   - Continue feature work
   - Include audit fix in next scheduled update
   - Include in PR with other changes

### Dependabot PR opened

1. **Review the PR:**
   - Check changelog for breaking changes
   - Look for deprecations
   - Verify tests still pass (CI does this)

2. **Security update?**
   - Auto-merged (usually within 24h)
   - Monitor merge status

3. **Feature/minor update?**
   - Review carefully
   - Test locally if major version bump
   - Approve and merge manually

### "Build failed: Critical vulnerability detected"

1. **Review the alert:**
   - Check GitHub Security tab
   - Find details in `.github/workflows/audit.yml`

2. **Assess impact:**
   - Does it affect production code?
   - Is there a patch available?

3. **Fix immediately:**
   ```bash
   npm audit fix
   npm test
   git commit -am "security: fix critical vulnerability"
   git push
   ```

4. **If no patch exists:**
   - File issue on upstream package
   - Consider alternative dependency
   - Document exception in SECURITY.md

## Adding New Dependencies

### Before installing:

1. **Check reputation:**
   ```bash
   npm view <package> | grep -E "downloads|maintainers|github"
   ```

2. **Check for vulnerabilities:**
   ```bash
   npm audit --package=<package>
   ```

3. **Review maintenance status:**
   - Recent commits
   - Active issues
   - License type

### After installing:

1. **Run audit:**
   ```bash
   npm audit
   ```

2. **Commit to git:**
   ```bash
   git add package.json package-lock.json
   git commit -m "deps: add <package> for <reason>"
   ```

3. **Create PR with description:**
   - Why this package?
   - How will it be used?
   - Any security considerations?

## CodeQL Analysis

Static code analysis runs automatically to find:
- SQL injection vulnerabilities
- Cross-site scripting (XSS)
- Sensitive data leaks
- Unsafe deserialization
- And more

**Results visible at:** Settings > Code security > Code scanning

## Dashboard & Visibility

### GitHub Security Tab

View all security findings:
- Dependabot alerts
- Code scanning results
- Secret scanning
- Security advisories

**Access:** Repository > Security

### Audit Artifacts

Full audit reports retained for 30 days:
- JSON format with full vulnerability details
- Available in workflow run artifacts
- Useful for compliance/auditing

## Escalation & Incidents

### Security issue found?

1. **Email:** security@nextellar.dev
2. **Include:**
   - Description
   - Reproduction steps
   - Impact assessment
3. **Response:** Within 24 hours
4. **Process:** Coordinated disclosure

## Best Practices

1. **Keep Node.js updated**
   ```bash
   nvm install 20  # Use LTS
   nvm use 20
   ```

2. **Review dependency tree**
   ```bash
   npm ls | grep vulnerable
   ```

3. **Lock file discipline**
   - Commit `package-lock.json`
   - Use `npm ci` in CI (not `npm install`)
   - Review lock file changes in PRs

4. **Minimal dependencies**
   - Only add what you need
   - Consider bundled alternatives
   - Remove unused packages regularly

5. **Test after updates**
   ```bash
   npm test
   npm run build
   npm run lint
   ```

## Troubleshooting

### Audit times out

```bash
# Increase timeout
npm audit --fetch-timeout 60000
```

### False positive vulnerability

1. **Verify it's a false positive:**
   - Check if we use the vulnerable code path
   - Check upstream issue tracker

2. **Document exception:**
   - Add to `.npmrc` or audit comments
   - Create GitHub issue with justification
   - Include review date

3. **Example `.npmrc`:**
   ```ini
   audit-level=moderate
   # CVE-2024-XXXXX: False positive - vulnerability not in our usage
   ```

### Persistent dependency conflicts

1. **Check why conflict exists:**
   ```bash
   npm ls <package>
   ```

2. **Options:**
   - Update to compatible version
   - Use peer dependency override
   - Switch packages

## Further Reading

- [SECURITY.md](../SECURITY.md) - Security policy details
- [npm audit documentation](https://docs.npmjs.com/auditing-package-contents-for-security-vulnerabilities)
- [GitHub Dependabot docs](https://docs.github.com/en/code-security/dependabot)
- [OWASP Dependency-Check](https://owasp.org/www-project-dependency-check/)
- [NPM Security Best Practices](https://docs.npmjs.com/security/)

## Questions?

- Check existing issues: GitHub > Security > Alerts
- Review SECURITY.md for policy details
- Contact: security@nextellar.dev
