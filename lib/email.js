/**
 * Email sending. No provider is configured yet — this stub logs instead of
 * sending. Swap the body of sendReminderEmail for a real provider (Resend,
 * SMTP, SendGrid, etc.) without touching any caller.
 */

export async function sendReminderEmail({ to, subject, body }) {
  console.log("[email:stub] would send reminder", { to, subject, body });
  return { sent: false, provider: "stub" };
}
