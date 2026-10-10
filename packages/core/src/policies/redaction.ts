/**
 * PII and secret redaction.
 * Runs before any memory write to scrub credentials, keys, and personal data.
 *
 * Rules (in order):
 * 1. Common API key prefixes (sk-, gh_, gho_, glpat-, xoxb-, etc.)
 * 2. Private key PEM blocks
 * 3. .env-style assignments (KEY=VALUE)
 * 4. High-entropy strings adjacent to secret-adjacent words
 * 5. Email addresses (tagged as PII, not redacted)
 */

/** Returns { text: redacted, pii: true/false } */
export function redact(input: string): { text: string; pii: boolean } {
  let text = input;
  let pii = false;

  // 1. Common API key / token prefixes
  const prefixPatterns = [
    /\b(sk-[A-Za-z0-9_-]{20,})/g, // OpenAI, Anthropic
    /\b(gh[posu]_[A-Za-z0-9_]{36,})/g, // GitHub tokens
    /\b(glpat-[A-Za-z0-9_-]{20,})/g, // GitLab PATs
    /\b(xox[bparos]-[A-Za-z0-9-]{10,})/g, // Slack tokens
    /\b(AKIA[A-Z0-9]{16})/g, // AWS access keys
    /\b(AIza[A-Za-z0-9_-]{30,40})/g, // Google API keys
    /\b(ya29\.[A-Za-z0-9_-]{60,})/g, // Google OAuth tokens
    /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, // JWTs
    /\b(Basic\s+[A-Za-z0-9+/]{20,}={0,2})/gi, // Basic auth
    /\b(Bearer\s+[A-Za-z0-9_.-]{20,})/gi, // Bearer tokens
    /\b([rs]k_live_[A-Za-z0-9]{24,})/g, // Stripe live keys
    /\b(npm_[A-Za-z0-9]{36})/g, // NPM access tokens
    /\b(SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/g, // SendGrid API keys
    /\b(AC[a-fA-F0-9]{32})/g, // Twilio Account SID
    /\b(pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]+)/g, // PyPI API tokens
  ];

  for (const pattern of prefixPatterns) {
    text = text.replace(pattern, "[REDACTED]");
  }

  // Database connection URIs with embedded passwords
  text = text.replace(
    /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:@/]+:)([^\s@/]+)(@)/gi,
    "$1[REDACTED]$3",
  );

  // 2. PEM blocks
  text = text.replace(
    /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
    "[REDACTED_PEM]",
  );

  // 3. .env-style KEY=VALUE with secret-adjacent words (case-insensitive)
  const secretWords =
    /(?:key|secret|token|password|passwd|pwd|auth|credential|api_key|access_key|private)/i;
  text = text.replace(
    /([A-Z_][A-Z0-9_]*)=([^\s"']+)/g,
    (match, name: string, value: string) => {
      if (secretWords.test(name) && value.length >= 8) {
        return `${name}=[REDACTED]`;
      }
      return match;
    },
  );

  // 4. High-entropy strings (>= 32 chars, base64/hex-like) near secret words
  const highEntropyNearSecret =
    /(?:key|secret|token|password|auth)['":\s=]+['"]?([A-Za-z0-9+/=_-]{32,})['"]?/gi;
  text = text.replace(highEntropyNearSecret, (match, val: string) => {
    if (shannonEntropy(val) > 3.5) {
      return match.replace(val, "[REDACTED]");
    }
    return match;
  });

  // 5. Email addresses - mark as PII but don't redact text
  if (/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(text)) {
    pii = true;
  }

  return { text, pii };
}

function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * File deny list - never store outputs from files matching these globs.
 * Checked against tool args (file paths).
 */
const DENY_FILE_PATTERNS = [
  /\.env(\.|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /id_dsa/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.cer$/i,
  /secrets\.(json|yaml|yml|toml)/i,
  /credentials\.(json|yaml|yml|toml)/i,
];

export function isDeniedFilePath(filePath: string): boolean {
  return DENY_FILE_PATTERNS.some((p) => p.test(filePath));
}

/** Check if tool args contain any denied file paths */
export function toolArgsDenied(toolArgs: unknown): boolean {
  if (!toolArgs || typeof toolArgs !== "object") return false;
  const values = Object.values(toolArgs as Record<string, unknown>);
  return values.some((v) => typeof v === "string" && isDeniedFilePath(v));
}
