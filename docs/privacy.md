# Privacy & Security Policy

`openmem` is designed with a **local-first, zero-telemetry** privacy posture. All data remains exclusively on your local workstation.

---

## 1. Core Principles

1. **Local-First Storage:** All memories and compressed references are stored in `.openmem/openmem.db` (SQLite) on your machine.
2. **Zero Network Egress:** The core engine, hooks, and MCP servers never make outbound network connections or communicate with external telemetry servers.
3. **Inspectable & Human-Editable:** Data can be exported to Markdown (`openmem export`), inspected with standard tools, edited directly, or purged with a single command.
4. **Isolated Namespaces:** Memories are partitioned by git repository root hash to prevent cross-project information leakage.

---

## 2. Automatic Secret Redaction

Before any text is written to the SQLite store, `@openmem/core/policies/redaction.ts` scrubs credentials using over 15 targeted pattern matchers:

| Secret Type | Matcher Pattern | Replacement |
|---|---|---|
| OpenAI API Keys | `sk-[a-zA-Z0-9]{20,}` | `[REDACTED]` |
| Anthropic API Keys | `sk-ant-[a-zA-Z0-9]{20,}` | `[REDACTED]` |
| GitHub Tokens | `gh[posu]_[a-zA-Z0-9]{36,}` | `[REDACTED]` |
| GitLab Personal Access Tokens | `glpat-[a-zA-Z0-9_-]{20,}` | `[REDACTED]` |
| Slack Tokens | `xox[baprs]-[a-zA-Z0-9-]{10,}` | `[REDACTED]` |
| AWS Access Key IDs | `AKIA[0-9A-Z]{16}` | `[REDACTED]` |
| Google Cloud API Keys | `AIza[0-9A-Za-z-_]{35}` | `[REDACTED]` |
| Google OAuth Tokens | `ya29\.[0-9A-Za-z-_]+` | `[REDACTED]` |
| JSON Web Tokens (JWT) | `eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+` | `[REDACTED_JWT]` |
| Basic & Bearer Auth | `(Basic\|Bearer)\s+[A-Za-z0-9+/=._-]+` | `Bearer [REDACTED]` |
| Stripe API Keys | `[rs]k_live_[0-9a-zA-Z]{24,}` | `[REDACTED]` |
| NPM Access Tokens | `npm_[A-Za-z0-9]{36}` | `[REDACTED]` |
| SendGrid API Keys | `SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}` | `[REDACTED]` |
| Twilio Account SIDs | `AC[a-f0-9]{32}` | `[REDACTED]` |
| PyPI API Tokens | `pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]+` | `[REDACTED]` |
| Database Connection URIs | `(?:postgres\|mysql\|mongodb)\:\/\/[^:]+:[^@]+@` | Credentials scrubbed |
| PEM Private Keys | `-----BEGIN (?:RSA )?PRIVATE KEY-----...` | `[REDACTED_PEM]` |
| High-Entropy Strings | Base64/Hex strings with Shannon entropy > 3.5 near secret keywords | `[REDACTED]` |
| Email Addresses | Marked with `pii = true` flag for audit and filtering |

---

## 3. Sensitive Path Deny List

When Copilot tools read files (e.g. `view` or `grep`), any command touching the following paths is **strictly denied from context compression and storage**:
- `.env*` (e.g. `.env`, `.env.local`, `.env.production`)
- `*.pem`, `*.key`, `*.pkcs12`
- `id_rsa`, `id_ed25519`
- `secrets.json`, `credentials.yaml`, `credentials.json`

---

## 4. Prompt Injection Defense

To guard against malicious content (e.g. untrusted third-party web pages visited during web fetches) injecting persistent instructions:
- Tool compression never auto-converts fetched web content into permanent memories.
- Memories are only created via explicit user commands or model `memory_remember` calls.
- Injected memories are framed inside structured `<openmem>` delimiters and presented strictly as historical repository facts.

---

## 5. Deletion & Data Retention

- **Single Memory Deletion:** `openmem forget <id>`
- **Complete Project Wipe:** `openmem forget --all`
- **Manual Purge:** Simply delete `.openmem/openmem.db`.
