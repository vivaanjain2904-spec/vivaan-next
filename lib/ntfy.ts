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

export async function alertUser(
  user: { ntfy_topic?: string | null; discord_webhook?: string | null },
  title: string,
  body: string,
) {
  await Promise.all([
    user.ntfy_topic ? sendNtfy(user.ntfy_topic, title, body) : null,
    user.discord_webhook ? sendDiscord(user.discord_webhook, title, body) : null,
  ]);
}
