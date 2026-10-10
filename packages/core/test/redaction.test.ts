import { describe, expect, it } from "vitest";
import { isDeniedFilePath, redact } from "../src/policies/redaction.js";

describe("redaction policy", () => {
  it("redacts OpenAI / Anthropic sk- keys", () => {
    const input = "Here is my key: sk-abc123456789012345678901234567890";
    const { text } = redact(input);
    expect(text).toBe("Here is my key: [REDACTED]");
  });

  it("redacts GitHub tokens (ghp, gho, ghs, ghu)", () => {
    const ghp = "ghp_123456789012345678901234567890123456";
    const gho = "gho_abcdefghijklmnopqrstuvwxyz1234567890";
    expect(redact(`Token ${ghp}`).text).toBe("Token [REDACTED]");
    expect(redact(`Token ${gho}`).text).toBe("Token [REDACTED]");
  });

  it("redacts GitLab PATs", () => {
    const glpat = "glpat-abcdefghijklmnopqrst12345";
    expect(redact(`GitLab ${glpat}`).text).toBe("GitLab [REDACTED]");
  });

  it("redacts Slack tokens (xoxb, xoxp)", () => {
    const slack = "xoxb-1234567890-123456789012";
    expect(redact(`Slack ${slack}`).text).toBe("Slack [REDACTED]");
  });

  it("redacts AWS access keys (AKIA...)", () => {
    const aws = "AKIAIOSFODNN7EXAMPLE";
    expect(redact(`AWS key ${aws}`).text).toBe("AWS key [REDACTED]");
  });

  it("redacts Google API keys (AIza...)", () => {
    const google = "AIzaSyD-1234567890abcdefghijklmnopqrst";
    expect(redact(`Google ${google}`).text).toBe("Google [REDACTED]");
  });

  it("redacts Google OAuth tokens (ya29...)", () => {
    const oauth = "ya29.a0AfH6SMC123456789012345678901234567890123456789012345678901234567890";
    expect(redact(`OAuth ${oauth}`).text).toBe("OAuth [REDACTED]");
  });

  it("redacts JWT tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozG96s41fP4mepnL_EXAMPLE";
    expect(redact(`Auth: ${jwt}`).text).toBe("Auth: [REDACTED]");
  });

  it("redacts Basic auth headers", () => {
    const basic = "Basic dXNlcm5hbWU6cGFzc3dvcmQxMjM0NQ==";
    expect(redact(`Authorization: ${basic}`).text).toBe("Authorization: [REDACTED]");
  });

  it("redacts Bearer tokens", () => {
    const bearer = "Bearer mysecrettoken123456789012345";
    expect(redact(`Header: ${bearer}`).text).toBe("Header: [REDACTED]");
  });

  it("redacts Stripe live keys", () => {
    const stripe = "sk_live_51Abcdefghijklmnopqrstuvwxy12345";
    expect(redact(`Stripe ${stripe}`).text).toBe("Stripe [REDACTED]");
  });

  it("redacts NPM access tokens", () => {
    const npm = "npm_abcdefghijklmnopqrstuvwxyz1234567890";
    expect(redact(`NPM ${npm}`).text).toBe("NPM [REDACTED]");
  });

  it("redacts SendGrid API keys", () => {
    const sg = "SG.abcdefghijklmnopqrstuv.1234567890abcdefghijklmnopqrstuvwxyz12345678901";
    expect(redact(`SendGrid ${sg}`).text).toBe("SendGrid [REDACTED]");
  });

  it("redacts Twilio Account SIDs", () => {
    const twilio = "AC1234567890abcdef1234567890abcdef";
    expect(redact(`Twilio ${twilio}`).text).toBe("Twilio [REDACTED]");
  });

  it("redacts PyPI tokens", () => {
    const pypi = "pypi-AgEIcHlwaS5vcmcCJDEyMzQ1Njc4LT";
    expect(redact(`PyPI ${pypi}`).text).toBe("PyPI [REDACTED]");
  });

  it("redacts database credentials in connection URIs", () => {
    const postgres = "postgres://admin:supersecretpassword123@localhost:5432/mydb";
    expect(redact(postgres).text).toBe("postgres://admin:[REDACTED]@localhost:5432/mydb");
  });

  it("redacts PEM blocks", () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y1+example
-----END RSA PRIVATE KEY-----`;
    expect(redact(pem).text).toBe("[REDACTED_PEM]");
  });

  it("redacts .env assignments with secret words", () => {
    const env = "API_KEY=mysupersecretkey12345\nDB_PASSWD=anothersecretpwd\nPORT=3000";
    const res = redact(env).text;
    expect(res).toContain("API_KEY=[REDACTED]");
    expect(res).toContain("DB_PASSWD=[REDACTED]");
    expect(res).toContain("PORT=3000");
  });

  it("flags emails as PII without redacting them", () => {
    const { text, pii } = redact("Contact developer@example.com for access.");
    expect(pii).toBe(true);
    expect(text).toContain("developer@example.com");
  });

  it("identifies denied file paths", () => {
    expect(isDeniedFilePath(".env")).toBe(true);
    expect(isDeniedFilePath(".env.local")).toBe(true);
    expect(isDeniedFilePath("server.pem")).toBe(true);
    expect(isDeniedFilePath("id_rsa")).toBe(true);
    expect(isDeniedFilePath("id_ed25519")).toBe(true);
    expect(isDeniedFilePath("secrets.json")).toBe(true);
    expect(isDeniedFilePath("credentials.yaml")).toBe(true);
    expect(isDeniedFilePath("src/index.ts")).toBe(false);
    expect(isDeniedFilePath("README.md")).toBe(false);
  });

  it("redacts high entropy strings near secret keywords", () => {
    const raw = "token: 4F8aB9zkL2mNpQrStUvWxYz0123456789abcDEF";
    const res = redact(raw).text;
    expect(res).toContain("[REDACTED]");
  });
});
