/**
 * Sends one test email straight away (not through the queue), to check the email setup:
 *
 *   npm run email:test -w apps/api -- you@example.com
 *
 * Uses EMAIL_PROVIDER and its settings from .env.<NODE_ENV>. Prints "Sent" or the provider's
 * error; never prints a password or key.
 */
import { env } from "../config/env";
import { isEmailConfigured, renderNotificationEmail, sendEmail, senderAddress } from "../services/notifications/email.service";

const to = process.argv[2];

const main = async () => {
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    console.error("Usage: npm run email:test -w apps/api -- you@example.com");
    process.exitCode = 1;
    return;
  }
  if (!isEmailConfigured()) {
    console.error(`No email provider is set up (EMAIL_PROVIDER=${env.EMAIL_PROVIDER}), so nothing would be sent.`);
    process.exitCode = 1;
    return;
  }

  const message = renderNotificationEmail({
    name: "there",
    title: "PurpleWallet test email",
    body: `If you can read this, emails from PurpleWallet are working. Sent with ${env.EMAIL_PROVIDER} from ${senderAddress()}.`,
    actionPath: "/",
    actionLabel: "Open PurpleWallet",
    footer: "You're receiving this because someone ran the email test command.",
  });

  console.log(`Sending a test email to ${to} with ${env.EMAIL_PROVIDER} (from ${senderAddress()})…`);
  try {
    await sendEmail({ to, ...message });
    console.log("Sent. Check the inbox (and the spam folder, the first time).");
  } catch (err) {
    console.error(`Not sent: ${err instanceof Error ? err.message : String(err)}`);
    if (env.EMAIL_PROVIDER === "gmail") {
      console.error("For Gmail: check GMAIL_USER, that GMAIL_APP_PASSWORD is an app password (not the account password), and that 2-step verification is on.");
    }
    process.exitCode = 1;
  }
};

main().finally(() => setTimeout(() => process.exit(), 100));
