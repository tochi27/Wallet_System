import { env } from "../../config/env";
import logger from "../../config/logger";

const RESEND_URL = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 10_000;

export type Email = { to: string; subject: string; html: string; text: string };

/**
 * Sends an email through Resend. Without RESEND_API_KEY (local development) the email is
 * logged instead, so notification flows can be exercised without a provider.
 */
export const sendEmail = async (email: Email): Promise<void> => {
  if (!env.RESEND_API_KEY) {
    logger.info({ to: email.to, subject: email.subject }, "Email not sent (RESEND_API_KEY unset)");
    return;
  }

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [email.to], subject: email.subject, html: email.html, text: email.text }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Throwing lets the notification job retry with backoff
    throw new Error(`Resend rejected the email (${res.status}): ${body.slice(0, 200)}`);
  }
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * A simple branded email. Every dynamic value is escaped: names and transfer notes are typed by
 * users and must not be able to inject markup into someone else's inbox.
 */
export const renderNotificationEmail = (input: {
  name: string;
  title: string;
  body: string;
  actionPath?: string;
  actionLabel?: string;
  footer?: string;
}): Omit<Email, "to"> => {
  const label = input.actionLabel ?? "Open your wallet";
  const footer = input.footer ?? "You're receiving this because of activity on your PurpleWallet account.";
  const link = `${env.APP_URL}${input.actionPath ?? "/wallet"}`;
  const firstName = input.name.split(/\s+/)[0] || input.name;
  const html = `<!doctype html>
<html><body style="margin:0;background:#f7f6fd;font-family:Inter,Segoe UI,Arial,sans-serif;color:#16131f">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px">
        <tr><td style="font-weight:700;font-size:18px;padding-bottom:24px"><span style="color:#6d4aff">Purple</span><span style="color:#16131f">Wallet</span></td></tr>
        <tr><td style="font-size:20px;font-weight:600;padding-bottom:12px">${escapeHtml(input.title)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.6;padding-bottom:8px">Hi ${escapeHtml(firstName)},</td></tr>
        <tr><td style="font-size:15px;line-height:1.6;padding-bottom:24px">${escapeHtml(input.body)}</td></tr>
        <tr><td><a href="${escapeHtml(link)}" style="display:inline-block;background:#6d4aff;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:999px;font-size:14px;font-weight:600">${escapeHtml(label)}</a></td></tr>
      </table>
      <p style="font-size:12px;color:#6b6880;max-width:480px">${escapeHtml(footer)}</p>
    </td></tr>
  </table>
</body></html>`;
  const text = `${input.title}\n\nHi ${firstName},\n\n${input.body}\n\n${label}: ${link}\n\n${footer}`;
  return { subject: input.title, html, text };
};
