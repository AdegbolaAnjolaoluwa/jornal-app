/**
 * Email sending. No provider is configured yet, so this stub does NOT send
 * anything and, critically, does NOT log secret material (reset tokens,
 * magic links) anywhere - server logs are not a secure channel and are
 * often readable by more people/tools than the production database itself.
 * Swap the body of each function for a real provider (Resend, SMTP,
 * SendGrid, etc.) without touching any caller.
 *
 * The caller (api/auth.js) already surfaces a `devResetUrl` field in the API
 * response itself, but ONLY when NODE_ENV !== "production" - that is the
 * one safe/intentional way this token is exposed outside the DB, and it is
 * gated at the call site, not here. This module must never independently
 * reintroduce a logging-based leak of that same token.
 */

export async function sendReminderEmail({ to, subject }) {
  if (process.env.NODE_ENV !== "production") {
    console.log("[email:stub] would send reminder to", to, "subject:", subject);
  } else {
    console.warn("[email:stub] no email provider configured - reminder not sent");
  }
  return { sent: false, provider: "stub" };
}

export async function sendPasswordResetEmail() {
  // Deliberately does not log `to` or `resetUrl` - the URL contains a live,
  // unhashed, single-use credential. Logging it here would let anyone with
  // log access take over the account, in production or not.
  if (process.env.NODE_ENV !== "production") {
    console.log("[email:stub] would send password reset (see devResetUrl in the API response for the link)");
  } else {
    console.warn("[email:stub] no email provider configured - password reset email not sent");
  }
  return { sent: false, provider: "stub" };
}
