// The loop: foundation, draft, feedback, daily. Each step reads files, asks the
// writer once or twice, and writes files. `complete` can be swapped in tests.
import path from 'node:path';
import * as store from './store.mjs';
import { lint, straighten } from './lint.mjs';
import { complete as realComplete } from './writer.mjs';

const { p, read, write, REPO } = store;

const tells = () => read(path.join(REPO, 'rules', 'ai-tells.md'));

function tag(text, name) {
  const m = String(text).match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

function parseJson(text) {
  const s = String(text);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The writer did not return JSON.');
  return JSON.parse(s.slice(start, end + 1));
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max)}\n[cut here for length]` : text;
}

// ---- foundation ----

export async function foundation({ complete = realComplete } = {}) {
  const config = store.loadConfig();
  const samples = store.samples();
  if (samples.length < 3) {
    throw new Error(
      `Found ${samples.length} writing sample(s) in voice/samples. Add at least 3 (10 to 20 works best) and run this again.`,
    );
  }
  const existing = read(p.voice());
  const template = read(path.join(REPO, 'templates', 'voice.template.md')).replace('NAME', config.name || 'me');
  const prompt = `Build the voice rules file for one person from their own writing.

<context>
${read(p.context()).trim() || '(none given)'}
</context>

<samples>
${samples.map((s, i) => `<sample n="${i + 1}" file="${s.name}">\n${clip(s.text, 6000)}\n</sample>`).join('\n')}
</samples>

${existing ? `<current_rules>\n${existing}\n</current_rules>\n\nRules already exist. Keep every rule under "Learned from edits" and "Allowed exceptions" word for word, and keep any other rule the samples do not contradict.\n` : ''}
<ai_tells>
${tells()}
</ai_tells>

Extract, do not invent. Every rule must come from something the samples show, and the rules for Rhythm, Words I use and Signature moves each carry a short quote from a sample as evidence. Fill these sections:

- Rhythm: usual sentence length, where paragraphs break, whether points are built up to or stated first.
- Words I use: the 15 to 25 words and phrases that recur, spelled exactly as written, slang and profanity included.
- Words I never use: words this person would plainly never say, judged from the samples, that ai_tells does not already list. Put each word in backticks, one per line. Five to fifteen is enough.
- Signature moves: 3 to 5 recurring patterns (how pieces open, how questions are used, how objections are handled).
- Humor: whether there is any, and its kind.
- How I sell: what the samples show about asking for something. Write "No samples show this yet." if none do.
- By format: any difference between short and long pieces that the samples show.
- Allowed exceptions: any item from ai_tells that this person plainly uses in the samples (for example exclamation marks). Put each in backticks. Leave empty if none.
- Learned from edits: leave empty unless current rules already have entries.

Write rules as instructions a writer can follow, one per bullet line starting with "- ".

Return the complete file inside <voice_md></voice_md> tags, using exactly this skeleton and these headings:

${template}`;
  const answer = await complete(prompt, config);
  const body = tag(answer, 'voice_md');
  if (!body || !/^##\s+Rhythm/m.test(body)) {
    throw new Error('The writer returned no usable rules file. Nothing was changed. Run it again.');
  }
  write(p.voice(), straighten(body).trimEnd() + '\n');
  store.logChanges({
    draftId: 'foundation',
    lessons: [`Rules ${existing ? 'rebuilt' : 'built'} from ${samples.length} samples.`],
    results: [],
  });
  return { samples: samples.length, file: p.voice() };
}

// ---- draft ----

function examples(formatId) {
  const accepted = store.listDrafts().filter((d) => d.status === 'accepted' && d.final);
  const same = accepted.filter((d) => d.format === formatId).slice(0, 3);
  const others = accepted.filter((d) => d.format !== formatId).slice(0, 2);
  return [...same, ...others];
}

function draftPrompt({ fmt, topic, note, previous }) {
  const recent = store.listDrafts().slice(0, 12).map((d) => `- ${d.topic}`).join('\n');
  const ex = examples(fmt.id);
  const sampleBlock = store
    .samples()
    .slice(0, 4)
    .map((s) => `<sample>\n${clip(s.text, 2500)}\n</sample>`)
    .join('\n');
  return `Write one ${fmt.label.toLowerCase()} in this person's voice.

<voice_rules>
${read(p.voice())}
</voice_rules>

<ai_tells>
${tells()}
</ai_tells>

<context>
${read(p.context()).trim() || '(none given)'}
</context>

${ex.length ? `<approved_pieces>\nThe person approved these. They are the best evidence of the voice.\n${ex.map((d) => `<piece format="${d.format}">\n${d.final}\n</piece>`).join('\n')}\n</approved_pieces>\n` : ''}
<their_own_writing>
${sampleBlock}
</their_own_writing>

Format: ${fmt.guide}

${topic ? `Topic: ${topic}` : `Pick the topic yourself from the subjects in the context. Avoid these recent topics:\n${recent || '(none yet)'}`}
${previous ? `\nThis replaces an earlier draft the person sent back.\n<earlier_draft>\n${previous}\n</earlier_draft>\n` : ''}${note ? `\nTheir note on what to change:\n<note>\n${note}\n</note>\n` : ''}
The voice rules win over every default you have. Where a rule under "Learned from edits" conflicts with an older rule, the learned rule wins. Draft in the voice from the first word. Then read every sentence against the sentence shapes in ai_tells and rewrite any that match, unless the voice rules allow it. Use only facts found in the context or the samples; where a needed fact is missing, write [FILL IN: what is needed].

Return exactly:
<topic>the topic in under ten words</topic>
<draft>
the piece, ready to paste
</draft>`;
}

async function writeChecked({ fmt, topic, note, previous, complete, config }) {
  let answer = await complete(draftPrompt({ fmt, topic, note, previous }), config);
  let text = tag(answer, 'draft');
  if (!text) throw new Error('The writer returned no draft. Try again.');
  let chosen = tag(answer, 'topic') || topic || 'untitled';
  text = straighten(text);
  let problems = lint(text);
  if (problems.length) {
    // One repair pass for the mechanical tells. What is left gets shown.
    const list = problems.map((x) => `- ${x.term} (${x.count}): ${x.fix}`).join('\n');
    answer = await complete(
      `This draft breaks the person's rules in the places listed. Fix those places and change nothing else.\n\n<draft>\n${text}\n</draft>\n\nProblems:\n${list}\n\nReturn the corrected piece inside <draft></draft> tags.`,
      config,
    );
    const fixed = tag(answer, 'draft');
    if (fixed) {
      text = straighten(fixed);
      problems = lint(text);
    }
  }
  return { text, topic: chosen, problems };
}

export async function draft({ format: formatId, topic, source = 'button', complete = realComplete } = {}) {
  const config = store.loadConfig();
  if (!store.hasFoundation()) {
    throw new Error('No voice/VOICE.md yet. Build the foundation first: add samples, then run "voice foundation".');
  }
  const fmt = store.format(formatId || config.formats[0], config);
  const result = await writeChecked({ fmt, topic: (topic || '').trim() || null, complete, config });
  return store.saveDraft({
    id: store.newId(fmt.id),
    created: new Date().toISOString(),
    day: store.today(),
    source,
    format: fmt.id,
    topic: result.topic,
    draft: result.text,
    problems: result.problems,
    status: 'pending',
    final: null,
    note: null,
    lessons: [],
    changes: [],
  });
}

// ---- feedback ----

async function learn({ item, final, note, action, complete, config }) {
  const prompt = `A person reviewed a draft written in their voice. Work out what their response teaches about how they write, and turn that into changes to their voice rules.

<voice_rules>
${read(p.voice())}
</voice_rules>

<draft format="${item.format}">
${item.draft}
</draft>

${final && final !== item.draft ? `<their_edited_version>\n${final}\n</their_edited_version>` : '(They did not edit the text.)'}

${note ? `<their_note>\n${note}\n</their_note>` : '(They left no note.)'}

Their decision: ${action}.

Compare the draft with their version line by line. Their edit is the ground truth; do not argue with it.

A change earns a rule only when it would apply to future pieces: a word they swapped out, a sentence shape they broke up, an opening they cut, a level of formality they shifted, a claim style they softened. A change to the facts or the subject of this one piece is not a voice rule. A typo fix is not a voice rule.

Prefer sharpening an existing rule to adding a new one. Use "replace" when a current rule was wrong or too loose, quoting the current rule line exactly in "old". Use "remove" when their response contradicts a current rule. Use "add" for something new; new rules go under the section they belong to, or under "Learned from edits" when none fits. A word they deleted and would never say goes under "Words I never use" in backticks. If they put back something listed in the AI tells, add it in backticks under "Allowed exceptions". Each rule is one instruction a writer can follow, with a short example taken from their version when there is one.

Returning no operations is correct when the response teaches nothing lasting.

Sections: ${store.SECTIONS.join(', ')}.

Return only JSON of this shape:
{"lessons": ["plain sentence saying what was learned"], "operations": [{"op": "add|replace|remove", "section": "...", "old": "current rule text, for replace and remove", "text": "the rule, for add and replace", "why": "the edit that shows it"}]}`;
  let parsed;
  try {
    parsed = parseJson(await complete(prompt, config));
  } catch (e) {
    return { lessons: [], results: [], error: `The rules were left unchanged: ${e.message}` };
  }
  const lessons = (parsed.lessons || []).map(String).slice(0, 8);
  const ops = Array.isArray(parsed.operations) ? parsed.operations.slice(0, 10) : [];
  const applied = store.applyOps(ops);
  if (applied.results.some((r) => r.done !== 'skipped')) write(p.voice(), applied.text);
  store.logChanges({ draftId: item.id, lessons, results: applied.results });
  return { lessons, results: applied.results };
}

// action: accept | reject | rewrite
// accept  - keep it (with the person's edits, if any). Edits and notes teach the rules.
// reject  - throw it out. The note teaches the rules.
// rewrite - learn from the edits and note, then write a replacement on the same topic.
export async function feedback({ id, action, final, note, complete = realComplete } = {}) {
  const config = store.loadConfig();
  if (!['accept', 'reject', 'rewrite'].includes(action)) throw new Error('action must be accept, reject or rewrite.');
  const item = store.getDraft(id);
  if (item.status !== 'pending') throw new Error(`Draft ${id} was already ${item.status}.`);
  const cleanFinal = final == null ? item.draft : straighten(String(final)).trim();
  const cleanNote = (note || '').trim() || null;
  const edited = cleanFinal !== item.draft.trim() && cleanFinal !== item.draft;
  if (action === 'accept' && !cleanFinal) throw new Error('The accepted text is empty.');

  let learned = { lessons: [], results: [] };
  if (edited || cleanNote) {
    learned = await learn({ item, final: cleanFinal, note: cleanNote, action, complete, config });
  }

  item.status = action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'rewritten';
  item.final = action === 'accept' ? cleanFinal : null;
  item.edited = edited ? cleanFinal : null;
  item.note = cleanNote;
  item.lessons = learned.lessons;
  item.changes = learned.results.filter((r) => r.done !== 'skipped');
  item.learnError = learned.error || null;
  item.reviewed = new Date().toISOString();
  store.saveDraft(item);

  let next = null;
  if (action === 'rewrite') {
    const fmt = store.format(item.format, config);
    const result = await writeChecked({
      fmt,
      topic: item.topic,
      note: cleanNote,
      previous: edited ? cleanFinal : item.draft,
      complete,
      config,
    });
    next = store.saveDraft({
      id: store.newId(fmt.id),
      created: new Date().toISOString(),
      day: store.today(),
      source: 'rewrite',
      replaces: item.id,
      format: fmt.id,
      topic: result.topic,
      draft: result.text,
      problems: result.problems,
      status: 'pending',
      final: null,
      note: null,
      lessons: [],
      changes: [],
    });
  }
  return { item, next };
}

// ---- daily ----

// One new draft per day. The format rotates through config.formats.
export async function daily({ complete = realComplete, force = false } = {}) {
  const config = store.loadConfig();
  const day = store.today();
  const all = store.listDrafts();
  const already = all.find((d) => d.source === 'daily' && d.day === day);
  if (already && !force) return { made: false, item: already };
  const count = all.filter((d) => d.source === 'daily').length;
  const formatId = config.formats[count % config.formats.length];
  const topic = store.nextTopic();
  const item = await draft({ format: formatId, topic, source: 'daily', complete });
  if (topic) store.nextTopic({ take: true });
  return { made: true, item };
}

export function status() {
  const config = store.loadConfig();
  const drafts = store.listDrafts();
  return {
    name: config.name,
    foundation: store.hasFoundation(),
    samples: store.samples().length,
    formats: store.formats(config).map((f) => ({ id: f.id, label: f.label, daily: config.formats.includes(f.id) })),
    daily: config.daily,
    pending: drafts.filter((d) => d.status === 'pending').length,
    accepted: drafts.filter((d) => d.status === 'accepted').length,
    total: drafts.length,
  };
}
