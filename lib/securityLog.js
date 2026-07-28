/**
 * Structured logging for security-relevant events (auth failures, password
 * resets, rate-limit hits) so they're greppable in Vercel's log output
 * separately from ordinary request/error noise, without standing up a
 * dedicated audit-log table or third-party service.
 *
 * Never pass raw passwords, tokens, or secrets as `detail` - only
 * identifiers (userId, email, IP) and outcome/reason strings.
 */

export function logSecurityEvent(event, detail = {}) {
  console.warn(
    JSON.stringify({
      securityEvent: event,
      time: new Date().toISOString(),
      ...detail,
    })
  );
}
