# Daily Voice Training

A project folder that teaches an AI to write like you.

It reads your own writing and builds a rules file, `voice/VOICE.md`. Then it writes drafts with those rules. You accept a draft, edit it, or say what is off, and each response becomes a sharper rule. It writes one new draft every day and tells you when it is ready.

It writes tweets, threads, LinkedIn posts, Instagram captions, email broadcasts and long-form paragraphs. You can add formats of your own.

## Two ways to run it

### Inside your agent

Open this folder in Claude Code, Codex, or any agent that reads files, and say:

> Read AGENTS.md and start.

The agent interviews you, collects your samples, writes your rules and gives you a first draft. Keep one project or chat for this. Each time you come back it shows you the waiting draft, takes your feedback and updates the rules.

### On the local page

You need Node 20 or later and one of: Claude Code, Codex, or an Anthropic API key.

```
node bin/voice.mjs serve
```

Open http://localhost:4747. Paste your writing, press **Build my voice rules**, then press **New draft** whenever you want one. Edit the text in place, add a note, and choose Accept, Rewrite it or Reject.

## The loop

1. **Foundation.** Your context and 10 to 20 pieces of your writing go in. `voice/VOICE.md` comes out, with a quote from your writing behind each rule.
2. **Draft.** A piece is written from the rules, your context and the drafts you already approved. A mechanical check catches the habits that mark writing as machine-made.
3. **Feedback.** Your edits and notes are compared with the draft. Changes that would apply to future pieces become rule changes. Each one is recorded in `voice/LOG.md` with the draft that caused it.
4. **Daily.** One new draft per day, rotating through your formats, taking the next idea from `voice/topics.md`.

## The daily draft

While the page is running, the draft is written at the time set in `voice/config.json` (`daily.time`, default 08:00) and a desktop notification is sent.

To get the draft with the page closed:

```
node bin/voice.mjs schedule install --time 08:00
```

On macOS this installs a daily job. On Linux and Windows it prints the line to add to your scheduler. `node bin/voice.mjs schedule remove` takes it out.

Other ways to be notified:

- Any service that accepts a JSON POST (Slack, Discord, ntfy, Make, Zapier): set `notify.webhook` in `voice/config.json`.
- Telegram: set the environment variables `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

## Commands

```
node bin/voice.mjs init --name "Your Name"
node bin/voice.mjs foundation
node bin/voice.mjs draft --format email-broadcast --topic "why I raised my prices"
node bin/voice.mjs list
node bin/voice.mjs accept <id> --file edited.txt --note "less formal"
node bin/voice.mjs rewrite <id> --note "open with the story"
node bin/voice.mjs reject <id> --note "I would never post this"
node bin/voice.mjs daily
node bin/voice.mjs check some-text.md
node bin/voice.mjs status
```

## Which model writes

The first one found is used: a command you set, Claude Code (`claude`), Codex (`codex`), then the Claude API (`ANTHROPIC_API_KEY`, after `npm install`). To choose, set `writer.provider` in `voice/config.json` to `claude-cli`, `codex-cli`, `claude-api` or `command`. `writer.model` sets the model. With `command`, `writer.command` is any program that reads a prompt on standard input and prints the answer.

## Your files

Everything about you lives in `voice/`:

```
voice/
  context.md     who you are and who reads you
  samples/       your own writing
  VOICE.md       your rules
  drafts/        every draft and what it taught
  LOG.md         every rule change
  topics.md      your idea queue
  config.json    formats, daily time, writer, notifications
```

`voice/VOICE.md` is plain text. Load it, with `rules/ai-tells.md`, in any other tool that writes for you.

The page listens on your own computer only. Your writing goes to the model that writes the drafts and nowhere else. If you keep your copy of this folder in git, keep that repository private.

## Tests

```
npm test
```
