// The whole loop against a stand-in writer, in a throwaway voice folder.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.VOICE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-test-'));
const store = await import('../src/store.mjs');
const engine = await import('../src/engine.mjs');
const { lint, straighten } = await import('../src/lint.mjs');
const { createServer } = await import('../src/server.mjs');
const schedule = await import('../src/schedule.mjs');

const VOICE = fs.readFileSync(new URL('../templates/voice.template.md', import.meta.url), 'utf8')
  .replace('## Rhythm\n', '## Rhythm\n- Short sentences. "I quit. Then I slept."\n')
  .replace('## Words I never use\n', '## Words I never use\n- `synergy`\n');

// Answers by what the prompt asks for. Records every prompt.
const prompts = [];
let draftText = 'I sold the van on a Tuesday.';
let feedbackJson = '{"lessons":[],"operations":[]}';
const fake = async (prompt) => {
  prompts.push(prompt);
  if (prompt.startsWith('Build the voice rules')) return `<voice_md>\n${VOICE}\n</voice_md>`;
  if (prompt.startsWith('A person reviewed')) return `Here you go:\n${feedbackJson}`;
  if (prompt.startsWith('This draft breaks')) return '<draft>I sold the van on a Tuesday.</draft>';
  return `<topic>selling the van</topic>\n<draft>\n${draftText}\n</draft>`;
};

before(() => {
  store.init({ name: 'Test Person' });
});

test('init creates the folder and leaves existing files alone', () => {
  assert.ok(fs.existsSync(store.p.context()));
  store.write(store.p.context(), 'mine\n');
  assert.deepEqual(store.init(), []);
  assert.equal(store.read(store.p.context()), 'mine\n');
});

test('foundation refuses to run on fewer than three samples', async () => {
  await assert.rejects(engine.foundation({ complete: fake }), /at least 3/);
  assert.equal(store.hasFoundation(), false);
});

test('draft refuses to run before the foundation exists', async () => {
  await assert.rejects(engine.draft({ complete: fake }), /foundation/);
});

test('foundation writes VOICE.md from samples', async () => {
  store.addSamples(['one piece', 'two piece', 'three piece', '   ']);
  assert.equal(store.samples().length, 3);
  const r = await engine.foundation({ complete: fake });
  assert.equal(r.samples, 3);
  assert.match(store.read(store.p.voice()), /## Rhythm\n- Short sentences/);
});

test('foundation keeps the old file when the writer returns junk', async () => {
  const before = store.read(store.p.voice());
  await assert.rejects(engine.foundation({ complete: async () => 'sorry, no' }), /no usable rules/);
  assert.equal(store.read(store.p.voice()), before);
});

test('lint finds tells and personal bans, and respects allowed exceptions', () => {
  const found = lint('We leverage synergy — and it transformed us!').map((f) => f.term);
  assert.deepEqual(found.sort(), ['!', 'em dash', 'leverage', 'synergy', 'transform'].sort());
  const allowed = VOICE.replace('## Allowed exceptions\n', '## Allowed exceptions\n- `!`\n- `transform`\n');
  const fewer = lint('It transformed us!', allowed).map((f) => f.term);
  assert.deepEqual(fewer, []);
  assert.equal(lint('A landscaper named Foster-Lee, transformer in hand.').some((f) => f.term === 'landscape'), false);
  assert.equal(straighten('“Hi” it’s'), '"Hi" it\'s');
});

test('a draft with tells gets one repair pass', async () => {
  draftText = 'This is crucial — truly.';
  const d = await engine.draft({ format: 'tweet', complete: fake });
  assert.equal(d.draft, 'I sold the van on a Tuesday.');
  assert.deepEqual(d.problems, []);
  assert.equal(d.status, 'pending');
  draftText = 'I sold the van on a Tuesday.';
});

test('accepting an unchanged draft calls no model and changes no rule', async () => {
  const d = await engine.draft({ format: 'tweet', topic: 'vans', complete: fake });
  const n = prompts.length;
  const voiceBefore = store.read(store.p.voice());
  const r = await engine.feedback({ id: d.id, action: 'accept', final: d.draft, complete: fake });
  assert.equal(prompts.length, n);
  assert.equal(r.item.status, 'accepted');
  assert.equal(r.item.final, d.draft);
  assert.equal(store.read(store.p.voice()), voiceBefore);
  await assert.rejects(engine.feedback({ id: d.id, action: 'accept', complete: fake }), /already accepted/);
});

test('an edit updates the rules and the log', async () => {
  const d = await engine.draft({ format: 'tweet', complete: fake });
  feedbackJson = JSON.stringify({
    lessons: ['Names the day of the week.'],
    operations: [
      { op: 'add', section: 'Learned from edits', text: 'Name the day. "On a Tuesday."', why: 'added the day' },
      { op: 'replace', section: 'Rhythm', old: 'Short sentences. "I quit. Then I slept."', text: 'Short sentences, then one long one.' },
      { op: 'remove', section: 'Words I never use', old: '`synergy`' },
      { op: 'add', section: 'Words I never use', text: '`van life`' },
      { op: 'remove', section: 'Humor', old: 'a rule that is not there' },
      { op: 'explode', section: 'Humor', text: 'x' },
    ],
  });
  const r = await engine.feedback({ id: d.id, action: 'accept', final: 'I sold the van. On a Tuesday.', note: 'more me', complete: fake });
  const voice = store.read(store.p.voice());
  assert.match(voice, /## Learned from edits\n- Name the day\. "On a Tuesday\."/);
  assert.match(voice, /## Rhythm\n- Short sentences, then one long one\./);
  assert.doesNotMatch(voice, /synergy/);
  assert.match(voice, /- `van life`/);
  assert.equal(r.item.changes.length, 4);
  assert.equal(r.item.final, 'I sold the van. On a Tuesday.');
  assert.match(store.read(store.p.log()), /Lesson: Names the day/);
  assert.equal(lint('I love van life.').some((f) => f.term === 'van life'), true);
  // every heading survives
  for (const s of store.SECTIONS) assert.match(voice, new RegExp(`^## ${s}$`, 'm'));
});

test('junk from the feedback model leaves the rules alone and still records the review', async () => {
  const d = await engine.draft({ format: 'tweet', complete: fake });
  const voiceBefore = store.read(store.p.voice());
  feedbackJson = 'I cannot do that';
  const r = await engine.feedback({ id: d.id, action: 'reject', note: 'too stiff', complete: fake });
  assert.equal(r.item.status, 'rejected');
  assert.match(r.item.learnError, /left unchanged/);
  assert.equal(store.read(store.p.voice()), voiceBefore);
  feedbackJson = '{"lessons":[],"operations":[]}';
});

test('rewrite produces a replacement draft that carries the note', async () => {
  const d = await engine.draft({ format: 'email-broadcast', topic: 'vans', complete: fake });
  const r = await engine.feedback({ id: d.id, action: 'rewrite', note: 'shorter', complete: fake });
  assert.equal(r.item.status, 'rewritten');
  assert.equal(r.next.status, 'pending');
  assert.equal(r.next.replaces, d.id);
  assert.match(prompts.at(-1), /<note>\nshorter\n<\/note>/);
});

test('approved pieces are shown to the writer as examples', async () => {
  await engine.draft({ format: 'tweet', complete: fake });
  assert.match(prompts.at(-1), /<approved_pieces>[\s\S]*On a Tuesday\./);
});

test('daily writes once per day, rotates formats and takes a topic', async () => {
  store.write(store.p.topics(), '# Topics\n- [ ] the first idea\n- [ ] the second idea\n');
  const a = await engine.daily({ complete: fake });
  assert.equal(a.made, true);
  assert.equal(a.item.source, 'daily');
  assert.equal(a.item.format, 'tweet');
  assert.match(prompts.at(-1), /Topic: the first idea/);
  assert.match(store.read(store.p.topics()), /- \[x\] the first idea\n- \[ \] the second idea/);
  const b = await engine.daily({ complete: fake });
  assert.equal(b.made, false);
  assert.equal(b.item.id, a.item.id);
  const c = await engine.daily({ complete: fake, force: true });
  assert.equal(c.item.format, 'email-broadcast');
});

test('a failed daily draft leaves the topic open', async () => {
  const before = store.read(store.p.topics());
  await assert.rejects(engine.daily({ force: true, complete: async () => 'nothing useful' }), /no draft/);
  assert.equal(store.read(store.p.topics()), before);
});

test('unknown format and bad ids are refused', async () => {
  await assert.rejects(engine.draft({ format: 'haiku', complete: fake }), /Unknown format/);
  assert.throws(() => store.getDraft('../../etc/passwd'), /Bad draft id/);
  assert.throws(() => store.getDraft('nope'), /No draft/);
});

test('schedule plan is a valid job for this platform', () => {
  const job = schedule.plan({ time: '07:30' });
  assert.equal(job.hour, 7);
  assert.equal(job.minute, 30);
  if (job.kind === 'launchd') assert.match(job.content, /<string>daily<\/string>/);
  else assert.match(job.line, /daily/);
  assert.throws(() => schedule.plan({ time: '25:00' }), /not a time/);
});

test('the page server: state, draft, feedback, and refusal of cross-site posts', async () => {
  const server = createServer({ complete: fake });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body, headers = {}) =>
    fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const page = await fetch(base + '/');
    assert.match(await page.text(), /AI Copy Trainer/);
    const state = await (await fetch(base + '/api/state')).json();
    assert.equal(state.status.foundation, true);

    const made = await (await post('/api/draft', { format: 'tweet', topic: '<script>alert(1)</script>' })).json();
    assert.equal(made.status, 'pending');
    const fb = await (await post('/api/feedback', { id: made.id, action: 'accept', final: made.draft })).json();
    assert.equal(fb.item.status, 'accepted');

    assert.equal((await post('/api/draft', {}, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await fetch(base + '/api/draft', { method: 'POST', body: 'x' })).status, 415);
    assert.equal((await post('/api/feedback', { id: '../x', action: 'accept' })).status, 400);
    assert.equal((await post('/api/feedback', { id: made.id, action: 'burn' })).status, 400);
    assert.equal((await fetch(base + '/api/nope')).status, 404);
    const bad = await fetch(base + '/api/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    assert.equal(bad.status, 400);
  } finally {
    server.close();
  }
});
