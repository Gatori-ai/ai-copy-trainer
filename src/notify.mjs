// Tell the person a draft is waiting. Every channel is best effort.
import { spawnSync } from 'node:child_process';
import { loadConfig } from './store.mjs';

export async function notify({ title, body, url }, config = loadConfig()) {
  const sent = [];
  if (config.notify.desktop) {
    if (process.platform === 'darwin') {
      const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
      if (spawnSync('osascript', ['-e', script]).status === 0) sent.push('desktop');
    } else if (process.platform === 'linux') {
      if (spawnSync('notify-send', [title, body]).status === 0) sent.push('desktop');
    }
  }
  // Any service that accepts a JSON POST: Slack, Discord, ntfy, Zapier, Make.
  const hook = process.env.VOICE_WEBHOOK || config.notify.webhook;
  if (hook) {
    try {
      const text = `${title}: ${body}${url ? ` ${url}` : ''}`;
      const res = await fetch(hook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, content: text, title, message: body, url }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) sent.push('webhook');
    } catch {
      // A failed ping never fails the draft.
    }
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (token && chat) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: `${title}\n${body}${url ? `\n${url}` : ''}` }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) sent.push('telegram');
    } catch {
      // Same as above.
    }
  }
  return sent;
}
