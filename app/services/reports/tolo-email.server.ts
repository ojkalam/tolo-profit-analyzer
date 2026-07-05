import { ServerClient } from "postmark";

let toloPostmark: ServerClient | null = null;

function getClient(): ServerClient | null {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) return null;
  if (!toloPostmark) {
    toloPostmark = new ServerClient(token);
  }
  return toloPostmark;
}

export interface ToloEmail {
  to: string;
  subject: string;
  html: string;
}

/**
 * Send via Postmark when configured; otherwise log (dev). Callers treat
 * errors as non-fatal — email is never allowed to break a job.
 */
export async function toloSendEmail(email: ToloEmail): Promise<void> {
  const client = getClient();
  if (!client) {
    console.log(
      `[tolo] email (Postmark not configured) → ${email.to}: ${email.subject}`,
    );
    return;
  }
  await client.sendEmail({
    From: process.env.TOLO_EMAIL_FROM ?? "reports@toloapps.com",
    To: email.to,
    Subject: email.subject,
    HtmlBody: email.html,
    MessageStream: "outbound",
  });
}
