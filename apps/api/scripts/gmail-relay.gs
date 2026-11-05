/**
 * PurpleWallet email relay: a Google Apps Script web app that sends the API's emails from this
 * Gmail account. It exists because free hosts such as Render block outgoing SMTP (Gmail's mail
 * servers); the API reaches this script over ordinary HTTPS instead. Setup is in DEPLOYMENT.md.
 *
 * - The shared secret lives in Script properties (RELAY_SECRET), never in this code.
 * - It only uses MailApp ("send email as you"): it can't read the mailbox.
 * - Google allows personal accounts about 100 recipients a day from scripts.
 */

function doPost(e) {
  try {
    var secret = PropertiesService.getScriptProperties().getProperty("RELAY_SECRET");
    var body = JSON.parse(e.postData.contents);

    // Apps Script web apps always answer 200, so the API reads the result from "ok"
    if (!secret || body.secret !== secret) return reply({ ok: false, error: "Not authorised" });
    if (!body.to || !body.subject || !(body.text || body.html)) return reply({ ok: false, error: "Missing to, subject or body" });

    MailApp.sendEmail({
      to: body.to,
      subject: body.subject,
      body: body.text || "",
      htmlBody: body.html || undefined,
      name: body.fromName || "PurpleWallet",
    });
    return reply({ ok: true, remainingToday: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

// Opening the web app's address in a browser shows this, which confirms it's deployed
function doGet() {
  return reply({ ok: true, service: "PurpleWallet email relay" });
}

function reply(result) {
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
