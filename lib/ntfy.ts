import { Resend } from "resend";

/** ntfy.sh push — free phone notifications, no account. */
export async function sendNtfy(topic: string, title: string, body: string) {
  if (!topic) return;
  await fetch(`https://ntfy.sh/${topic.trim()}`, {
    method: "POST",
    headers: {
      "Title": title,
      "Priority": "high",
      "Tags": "chart_with_upwards_trend",
    },
    body,
  }).catch(() => {});
}

export async function sendDiscord(webhook: string, title: string, body: string) {
  if (!webhook) return;
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: `**${title}**\n${body}` }),
  }).catch(() => {});
}

/** Email via Resend. Needs RESEND_API_KEY env var; optional RESEND_FROM overrides sender. */
export async function sendEmail(to: string, title: string, body: string) {
  if (!to || !process.env.RESEND_API_KEY) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM ?? "Vaelor <onboarding@resend.dev>";
    await resend.emails.send({
      from,
      to: to.trim(),
      subject: title,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:28px;background:#0a0a0b;color:#fafafa;border-radius:12px">
          <div style="font-family:'Cinzel',Georgia,serif;font-weight:900;letter-spacing:0.26em;color:#34d399;font-size:22px;margin-bottom:24px">VAELOR</div>
          <h2 style="color:#fafafa;font-size:18px;margin:0 0 12px">${escapeHtml(title)}</h2>
          <p style="color:#a1a1aa;font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap">${escapeHtml(body)}</p>
          <hr style="border:none;border-top:1px solid #262629;margin:24px 0" />
          <p style="color:#71717a;font-size:11px;margin:0">Sent by Vaelor · <a href="https://vaelor.dev/settings" style="color:#34d399;text-decoration:none">manage notifications</a></p>
        </div>
      `,
      text: `${title}\n\n${body}\n\n— Vaelor · https://vaelor.dev/settings`,
    });
  } catch (e) {
    console.error("Email send failed:", e);
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

export async function alertUser(
  user: { ntfy_topic?: string | null; discord_webhook?: string | null; email?: string | null },
  title: string,
  body: string,
) {
  await Promise.all([
    user.ntfy_topic     ? sendNtfy(user.ntfy_topic, title, body)        : null,
    user.discord_webhook ? sendDiscord(user.discord_webhook, title, body) : null,
    user.email          ? sendEmail(user.email, title, body)            : null,
  ]);
}
