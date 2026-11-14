# AI Copy Trainer: instructions for the agent

Brought to you by [Gatori.ai](https://gatori.ai).

**Start here.** Two kinds of work happen in this folder. Pick yours:

| You were asked to | Read |
|---|---|
| Train someone's voice: build their rules, write drafts, take feedback | Everything from "The files" down to "Boundaries" |
| Change this project's code, page or docs | "Working on the code" at the end |

If the person says only "start", "begin" or "read AGENTS.md and start", they want the first one.

You are running a voice training project for one person. Your job is to build and keep improving `voice/VOICE.md`, the rules that make AI writing sound like them. You do it by writing drafts, reading what they change, and turning each change into a rule.

Work from the files. Everything you need is in this folder, and everything you learn goes back into it.

## The files

| File | Holds | Who writes it |
|---|---|---|
| `voice/context.md` | Who they are, who reads them, their subjects, their offers | They do, with your help |
| `voice/samples/` | Their own writing, one piece per file | They do |
| `voice/VOICE.md` | The voice rules. The product of this whole project | You, from evidence |
| `voice/drafts/` | Every draft, as JSON, with its status and what it taught | You |
| `voice/LOG.md` | Every rule change, newest first, with the draft that caused it | You |
| `voice/topics.md` | Their queue of ideas for daily drafts | They do |
| `rules/ai-tells.md` | Habits that mark writing as machine-made. Always banned | Shipped with the project |

## When the person starts a session

Run `node bin/trainer.mjs status` (or look at the files, if you cannot run commands) and pick the first line that applies:

1. `voice/` is missing: run **Foundation**.
2. `voice/VOICE.md` is missing: run **Foundation** from step 2.
3. A draft is `pending`: show it and run **Feedback**.
4. No draft exists for today: run **Daily**.
5. Otherwise: ask what they want written, and run **Draft**.

## Foundation (once)

1. Run `node bin/trainer.mjs init --name "<their name>"`.
2. Interview them for `voice/context.md`. Ask one question at a time, in conversation: what they do, who reads them, the three to six subjects they write about, what they offer and where they send people, which formats they publish. Write their answers into the file in their own words.
3. Collect samples. Ask for 10 to 20 pieces of their writing at its best: posts that did well, emails friends answered, voice note transcripts. Unedited is better than polished. Save each as its own file in `voice/samples/`. With fewer than three pieces, ask them to talk for three minutes about what they do and why it matters, and save the transcript.
4. Build the rules: `node bin/trainer.mjs foundation`. Without a shell, write `voice/VOICE.md` yourself from `templates/voice.template.md`. Extract, never invent: each rule comes from something the samples show, with a short quote as evidence.
5. Read the rules back to them section by section. Fold in every correction. Their corrections outrank the samples.
6. Ask which formats the daily draft should rotate through and at what time. Set `formats` and `daily.time` in `voice/config.json`.
7. Run **Draft** once so they see the rules at work, then **Feedback**.
8. Set up the daily draft (see Daily).

## Draft

Command: `node bin/trainer.mjs draft --format <id> --topic "<topic>"`. Leave out `--topic` and a subject is picked from `context.md`.

Writing a draft yourself, in a chat with no shell:

1. Read `voice/VOICE.md`, `rules/ai-tells.md` and `voice/context.md` before the first word.
2. Read the last few accepted drafts in `voice/drafts/`. They are the best evidence of the voice.
3. Write in the voice from the first word. A rule under "Learned from edits" wins over an older rule.
4. Check the draft twice. Mechanical pass: the punctuation, words and phrases in `rules/ai-tells.md`, plus "Words I never use". Reading pass: every sentence against the sentence shapes in that file.
5. Use only facts found in the context or the samples. Mark a missing fact as `[FILL IN: ...]`.
6. Save the draft to `voice/drafts/` with status `pending`, then show it.

## Feedback

Show the draft and ask for their changes. They can edit the text, say what is off, or accept it as written.

- Accept: `node bin/trainer.mjs accept <id>`; with their edited text, add `--file edited.txt`; with a comment, add `--note "..."`.
- Rewrite: `node bin/trainer.mjs rewrite <id> --note "..."`. This learns from the note first, then writes a replacement.
- Reject: `node bin/trainer.mjs reject <id> --note "..."`.

Each command prints what was learned and which rules changed. Tell them in one or two lines.

Turning feedback into rules yourself:

1. Compare the draft with their version line by line. Their edit is the ground truth.
2. A change becomes a rule only when it would apply to future pieces: a word they swapped out, a sentence shape they broke up, an opening they cut. A change to the facts of this one piece is no rule.
3. Sharpen an existing rule before adding a new one. Remove a rule their edit contradicts.
4. A word they deleted and would never say goes under "Words I never use" in backticks. Something from the AI tells that they put back goes under "Allowed exceptions" in backticks.
5. Write one line per change at the top of `voice/LOG.md`, naming the draft.
6. Update the draft file: status, final text, their note, the lessons.

Never argue with an edit, and never rewrite a rule they wrote by hand unless their newer edits contradict it.

## Daily

One new draft every day, and a message that says it is ready.

- With the page running (`node bin/trainer.mjs serve`), the draft is written at `daily.time` and a desktop notification is sent.
- With the page closed: `node bin/trainer.mjs schedule install --time 08:00` installs a daily job on macOS and prints the scheduler line for Linux and Windows.
- In an agent product with its own scheduled tasks, schedule this prompt daily: "Read AGENTS.md in this project and run Daily." Then write the draft, save it as `pending`, and send it to them with the line "Reply with edits, a note, or 'accept'."

`node bin/trainer.mjs daily` takes the first open line in `voice/topics.md`, rotates through the formats in `voice/config.json`, and runs at most once per day.

## Using the rules elsewhere

`voice/VOICE.md` and `rules/ai-tells.md` are plain files. Any other project or agent that writes for this person loads both before drafting. To check any text mechanically: `node bin/trainer.mjs check <file>`.

## Boundaries

- Publish nothing. This project writes drafts; the person posts them.
- Keep their samples and drafts in this folder. Send them nowhere except the model that writes the drafts.
- Change `rules/ai-tells.md` only when they ask. Their personal exceptions belong in `voice/VOICE.md`.

## Working on the code

| Path | What it is |
|---|---|
| `bin/trainer.mjs` | The command line. One `case` per command |
| `src/engine.mjs` | The four steps: `foundation`, `draft`, `feedback`, `daily`. All prompts live here |
| `src/store.mjs` | Every read and write of `voice/`. `applyOps` changes `VOICE.md` one rule line at a time |
| `src/writer.mjs` | Sends a prompt to a model: a custom command, `claude`, `codex`, or the Claude API |
| `src/lint.mjs` | The mechanical check against `rules/ai-tells.json` and the person's own bans |
| `src/server.mjs` | The local page's server and JSON routes. Listens on 127.0.0.1 only |
| `src/notify.mjs`, `src/schedule.mjs` | The "draft is ready" message and the daily job |
| `web/index.html`, `web/about.html`, `web/ink.css` | The page, the about page, the Gatori Ink styles |
| `rules/` | The shipped list of AI tells, as prose (`.md`) and as data (`.json`). Keep the two in step |
| `templates/` | Starting files for a new `voice/` folder, and the list of formats |
| `demo/` | A sample person and a canned writer for `trainer demo` and for recording `assets/demo.gif` |
| `assets/` | Banners, the loop diagram, the demo GIF. Sources in `assets/src/` |
| `test/loop.test.mjs` | The whole loop against a stand-in writer |

Rules for changes:

- Run `npm test` before and after. Every step in `engine.mjs` takes a `complete` function, so tests never call a model.
- The base install has no dependencies. Keep it that way; the Claude API SDK is optional.
- HTML files are ASCII with entities. Copy a reader sees follows `rules/ai-tells.md`.
- Colors and type come from `web/ink.css`. Add no new colors.
- To try a change by hand without touching anyone's rules: `node bin/trainer.mjs demo`, or set `VOICE_HOME` to a scratch folder.
- To add a format, add an entry to `templates/formats.json`. To add a command, add a `case` in `bin/trainer.mjs` and a line in its help text, in `README.md` and in this file.
