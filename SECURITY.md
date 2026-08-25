# Security Policy

## Overview

Nextellar takes security seriously. This document defines our dependency vulnerability management policy, severity gates, and remediation procedures.

## Vulnerability Severity Levels

We follow [npm audit severity classifications](https://docs.npmjs.com/about-audit-severity):

| Severity | Risk Level | Examples | Response Time |
|----------|-----------|----------|---|
| **Critical** | 🔴 Maximum | Remote code execution, authentication bypass, data exfiltration | Immediate (< 24 hours) |
| **High** | 🟠 Significant | Information disclosure, privilege escalation, local file access | 7 days |
| **Moderate** | 🟡 Medium | Denial of service, reduced security, performance issues | 30 days |
| **Low** | 🔵 Low | Minor security concerns, best practice violations | 90 days |

## Policy

### Continuous Auditing

**Automated checks run on:**
- Every push to `main` and `develop` branches
- Every pull request modifying `package.json`
- Daily scheduled audits (2 AM UTC)
- Manual workflow dispatch

### Severity Gates

**CI/CD Build Status:**

- ✅ **PASS** - 0 critical, 0 high vulnerabilities
- ⚠️ **WARN** - Moderate vulnerabilities detected (allowed to merge, must remediate within 30 days)
- ❌ **FAIL** - Any critical or high severity vulnerabilities (blocks merge)

**Rule Details:**

```
if (critical > 0 || high > 0) {
  FAIL_BUILD = true
  block_merge = true
  create_security_issue = true
  notify_team = true
}

if (moderate > 0 && critical === 0 && high === 0) {
  WARN_BUILD = true
  allow_merge = true
  create_issue = true
  set_due_date = today + 30 days
}

if (low > 0 && critical === 0 && high === 0 && moderate === 0) {
  PASS_BUILD = true
  log_for_tracking = true
}
```

### Reporting & Visibility

All vulnerability audits are:

1. **Reported to GitHub Security Tab** - SARIF format for native integration
2. **Commented on PRs** - Summary table with vulnerability counts
3. **Tracked in Issues** - For moderate/high severity findings
4. **Logged in CI Artifacts** - Full audit JSON reports retained 30 days

## Remediation Procedures

### For Critical/High Vulnerabilities

1. **Immediate Action** (< 24 hours)
   - Assess impact on the project
   - Check for available patches
   - Create security issue with `security` label

2. **Fix Priority**
   - Update vulnerable package to latest patch
   - If no patch available, evaluate alternatives
   - If no alternative, isolate vulnerable dependency

3. **Verification**
   - Run full test suite
   - Re-run audit to confirm fix
   - Deploy immediately after verification

4. **Communication**
   - Document in security issue
   - Link to pull request
   - Post-mortem analysis for patterns

### For Moderate Vulnerabilities

1. **Assessment** (within 3 days)
   - Evaluate if vulnerability is exploitable in our context
   - Review patch availability and changelog
   - Estimate update effort

2. **Remediation** (within 30 days)
   - Create issue with due date (current + 30 days)
   - Plan update in next sprint
   - Prioritize if affecting production

3. **Tracking**
   - Link to milestone
   - Assign to team member
   - Track in security dashboard

### For Low Vulnerabilities

1. **Tracking** (periodic review)
   - Monitor in audit reports
   - Include in quarterly reviews
   - Update when major version bumps

## Dependency Update Process

### Automated Updates (Dependabot)

**Enabled for:**
- Security updates (automatic PR creation + merge)
- Minor version updates (PR only, manual merge)
- Patch version updates (PR only, manual merge)

**Configuration:**
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "03:00"
    open-pull-requests-limit: 10
    pull-request-branch-name:
      separator: "/"
    reviewers:
      - "security-team"
    allow:
      - dependency-type: "direct"
      - dependency-type: "indirect"
    ignore:
      # Add packages to ignore long-term broken releases, etc.
```

### Manual Update Workflow

1. **Review** - Check changelog for breaking changes
2. **Test** - Run full test suite locally
3. **Verify** - Re-audit after update
4. **Commit** - Clear commit message with reason
5. **Deploy** - Follow release process

## Excluded Vulnerabilities

Certain vulnerabilities may be excluded from the policy due to:

- **False positives** - Vulnerability doesn't apply to our usage
- **Transitive only** - Affects deep dependency not directly used
- **Intentional risk** - Documented exception with justification
- **EOL software** - Acknowledged debt item in backlog

**Exclusion process:**
1. Document in `.npmrc` or audit comments
2. Create GitHub issue with label `vulnerability-exception`
3. Include detailed justification
4. Set review date (quarterly minimum)

Example `.npmrc`:
```ini
# Security: exclude false positives and known issues
audit-level=moderate
fund=false
legacy-peer-deps=false
```

## License Policy

**Approved Licenses:**
- Apache-2.0, Apache-2.0+
- MIT, MIT+
- ISC, BSD, BSD-2-Clause, BSD-3-Clause, 0BSD
- MPL-2.0
- LGPL-2.1, LGPL-3.0
- Unlicense

**Restricted Licenses:**
- GPL (requires review - may require COPYING file)
- AGPL (generally not permitted without explicit approval)
- SSPL (commercial license - requires assessment)

**Process for restricted licenses:**
1. Create issue with `license-review` label
2. Document business justification
3. Obtain approval from legal/security team
4. Document exception in project

## Incident Response

### Detection

Vulnerabilities are detected via:
1. **GitHub Dependabot** - Native GitHub detection
2. **npm audit** - Local and CI scanning
3. **CodeQL Analysis** - Code-level security issues
4. **Security reports** - Manual reports from community

### Triage

Upon detection:
1. Assess actual impact vs. theoretical risk
2. Determine if it affects production systems
3. Check if already patched
4. Estimate effort to fix

### Response Timeline

| Severity | Triage | Decision | Fix | Deploy |
|----------|--------|----------|-----|--------|
| Critical | < 2h | < 4h | < 24h | < 24h |
| High | < 4h | < 8h | < 7d | < 7d |
| Moderate | < 1d | < 3d | < 30d | < 30d |
| Low | < 7d | < 14d | < 90d | < 90d |

### Communication

- **Internal** - Slack notification to #security
- **Public** - GitHub security advisory (if applicable)
- **Users** - Security bulletin (for production incidents)

## Secure Development Practices

Beyond dependency management:

1. **Code Review** - All PRs require review
2. **Testing** - Full test coverage maintained
3. **SAST** - Static analysis via CodeQL
4. **Secrets** - Never commit credentials (git-secrets enabled)
5. **Validation** - Input validation on all entry points
6. **Dependencies** - Minimize external dependencies
7. **Pinning** - Use exact versions for production

## Monitoring & Reporting

### Metrics Tracked

- Total vulnerabilities by severity
- Time-to-remediation by severity
- Mean audit time
- False positive rate
- Vulnerability density (vuln/1000 LOC)

### Reporting Cadence

- **Daily** - Automated CI reports
- **Weekly** - Summary to team
- **Monthly** - Metrics dashboard review
- **Quarterly** - Full security audit + exceptions review

### Dashboard Access

GitHub Security tab: `Settings > Security > Dependabot` for:
- Dependency alerts
- Code scanning alerts
- Security advisories

## Responsible Disclosure

If you discover a security vulnerability:

1. **Do not** open a public GitHub issue
2. **Do** email `security@nextellar.dev` with:
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact
   - Your contact information

3. **We will:**
   - Acknowledge receipt within 24 hours
   - Provide updates every 7 days
   - Credit you in security advisory (optional)
   - Work toward public disclosure timeline

## Tools & Configuration

### CI Tools

- **npm audit** - Built-in Node.js dependency auditing
- **GitHub Dependabot** - Automated dependency updates
- **CodeQL** - Static analysis and code scanning
- **Dependency Review** - GitHub Actions for license/vulnerability review

### Local Tools

**Install locally:**
```bash
# npm audit (built-in)
npm audit

# npm audit fix
npm audit fix

# Specific auditing
npm audit --audit-level=moderate
npm audit --json > audit-report.json
```

### Scripts

Added to `package.json`:
```json
{
  "scripts": {
    "audit": "npm audit --audit-level=moderate",
    "audit:fix": "npm audit fix",
    "audit:strict": "npm audit --audit-level=low"
  }
}
```

## References

- [npm audit documentation](https://docs.npmjs.com/auditing-package-contents-for-security-vulnerabilities)
- [GitHub Dependabot](https://docs.github.com/en/code-security/dependabot)
- [OWASP Dependency-Check](https://owasp.org/www-project-dependency-check/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [NPM Security Best Practices](https://docs.npmjs.com/security/)

## Policy Changelog

### v1.0.0 - Initial Release
- Established severity gates
- Defined remediation timelines
- Enabled automated auditing
- Created incident response procedures

## Questions or Feedback?

Contact: security@nextellar.dev or open a discussion in GitHub.

---

**Last Updated:** 2026-08-24  
**Next Review:** 2026-11-24  
**Status:** ✅ Active
