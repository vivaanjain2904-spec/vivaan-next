import { Resend } from "resend";

export type ChannelResult = { channel: string; ok: boolean; error?: string };

/** ntfy.sh push — free phone notifications, no account. */
export async function sendNtfy(topic: string, title: string, body: string): Promise<ChannelResult> {
  if (!topic) return { channel: "ntfy", ok: false, error: "no topic configured" };
  try {
    const r = await fetch(`https://ntfy.sh/${topic.trim()}`, {
      method: "POST",
      headers: {
        "Title": title,
        "Priority": "high",
        "Tags": "chart_with_upwards_trend",
      },
      body,
    });
    if (!r.ok) return { channel: "ntfy", ok: false, error: `HTTP ${r.status}` };
    return { channel: "ntfy", ok: true };
  } catch (e: any) {
    return { channel: "ntfy", ok: false, error: String(e?.message ?? e) };
  }
}

export async function sendDiscord(webhook: string, title: string, body: string): Promise<ChannelResult> {
  if (!webhook) return { channel: "discord", ok: false, error: "no webhook configured" };
  try {
    const r = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `**${title}**\n${body}` }),
    });
    if (!r.ok) return { channel: "discord", ok: false, error: `HTTP ${r.status}` };
    return { channel: "discord", ok: true };
  } catch (e: any) {
    return { channel: "discord", ok: false, error: String(e?.message ?? e) };
  }
}

/** Email via Resend. Needs RESEND_API_KEY env var; optional RESEND_FROM overrides sender. */
export async function sendEmail(to: string, title: string, body: string): Promise<ChannelResult> {
  if (!to) return { channel: "email", ok: false, error: "no address configured" };
  if (!process.env.RESEND_API_KEY)
    return { channel: "email", ok: false, error: "RESEND_API_KEY env var not set on server" };
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM ?? "Vaelor <onboarding@resend.dev>";
    const r = await resend.emails.send({
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
    if ((r as any).error) {
      const err = (r as any).error;
      return { channel: "email", ok: false, error: `${err.name ?? "Error"}: ${err.message ?? JSON.stringify(err)}` };
    }
    return { channel: "email", ok: true };
  } catch (e: any) {
    return { channel: "email", ok: false, error: String(e?.message ?? e) };
  }
}

/** Send a raw HTML email via Resend. For transactional auth emails. */
export async function sendRawEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!to || !process.env.RESEND_API_KEY) return false;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM ?? "Vaelor <onboarding@resend.dev>";
    const r = await resend.emails.send({ from, to: to.trim(), subject, html });
    return !(r as any).error;
  } catch {
    return false;
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
): Promise<ChannelResult[]> {
  const tasks: Promise<ChannelResult>[] = [];
  if (user.ntfy_topic)      tasks.push(sendNtfy(user.ntfy_topic, title, body));
  if (user.discord_webhook) tasks.push(sendDiscord(user.discord_webhook, title, body));
  if (user.email)           tasks.push(sendEmail(user.email, title, body));
  return tasks.length ? Promise.all(tasks) : [];
}
