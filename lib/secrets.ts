/**
 * Server-only helpers that keep credentials out of anything the agents can
 * see or say: tool outputs, sandbox command output, and persistent memory.
 *
 * The models never receive these values in the first place (tools call the
 * store API server-side and the sandbox runs with no credentials and no
 * network), so this is defense in depth rather than the primary control.
 */
import { ADMIN_PASSWORD } from "./admin-auth";

function secretValues(): string[] {
  return [
    process.env.BYPASS_SECRET,
    process.env.AI_GATEWAY_API_KEY,
    process.env.VERCEL_OIDC_TOKEN,
    process.env.VERCEL_TOKEN,
    ADMIN_PASSWORD,
  ].filter((value): value is string => !!value && value.length >= 8);
}

/** Replace any known secret value in `text` with `[redacted]`. */
export function redactSecrets(text: string): string {
  let result = text;
  for (const secret of secretValues()) {
    result = result.split(secret).join("[redacted]");
  }
  return result;
}

/** True when `text` contains a known secret value. */
export function containsSecret(text: string): boolean {
  return secretValues().some((secret) => text.includes(secret));
}
