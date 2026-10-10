/**
 * Stable identifier material for a server-side login throttle bucket.
 * This must never include user-controlled browser IDs, user agents, or Origin,
 * because an attacker can change those between password guesses.
 *
 * The caller must HMAC this string with a server-only key before storage.
 * Client IP still depends on the gateway's forwarding-header trust policy.
 */
export function loginBucketMaterial(email: string, clientIp: string): string {
  return ["repcount-login-v2", email.trim().toLowerCase(), clientIp.trim()].join("\n");
}
