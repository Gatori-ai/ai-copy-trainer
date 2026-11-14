// Files on disk are the whole state. Nothing here calls a model.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '..');

// VOICE_HOME lets one checkout serve a voice folder kept somewhere else.
export function home() {
  return process.env.VOICE_HOME ? path.resolve(process.env.VOICE_HOME) : path.join(REPO, 'voice');
}

export const p = {
  config: () => path.join(home(), 'config.json'),
  context: () => path.join(home(), 'context.md'),
  voice: () => path.join(home(), 'VOICE.md'),
  log: () => path.join(home(), 'LOG.md'),
  topics: () => path.join(home(), 'topics.md'),
  samples: () => path.join(home(), 'samples'),
  drafts: () => path.join(home(), 'drafts'),
};

export const SECTIONS = [
  'Rhythm',
  'Words I use',
  'Words I never use',
  'Signature moves',
  'Humor',
  'How I sell',
  'By format',
  'Allowed exceptions',
  'Learned from edits',
];

const DEFAULT_CONFIG = {
  name: '',
  formats: ['tweet', 'email-broadcast', 'instagram-caption'],
  customFormats: [],
  daily: { enabled: true, time: '08:00' },
  writer: { provider: 'auto', model: null, command: null },
  notify: { desktop: true, webhook: null },
  port: 4747,
};

export function read(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

export function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export function loadConfig() {
  let saved = {};
  try {
    saved = JSON.parse(read(p.config(), '{}'));
  } catch {
    throw new Error(`${p.config()} is not valid JSON. Fix it or delete it and run "voice init".`);
  }
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    daily: { ...DEFAULT_CONFIG.daily, ...(saved.daily || {}) },
    writer: { ...DEFAULT_CONFIG.writer, ...(saved.writer || {}) },
    notify: { ...DEFAULT_CONFIG.notify, ...(saved.notify || {}) },
  };
}

export function saveConfig(config) {
  write(p.config(), JSON.stringify(config, null, 2) + '\n');
}

export function formats(config = loadConfig()) {
  const shipped = JSON.parse(read(path.join(REPO, 'templates', 'formats.json')));
  const all = [...shipped, ...(config.customFormats || [])];
  return all;
}

export function format(id, config = loadConfig()) {
  const found = formats(config).find((f) => f.id === id);
  if (!found) {
    const known = formats(config).map((f) => f.id).join(', ');
    throw new Error(`Unknown format "${id}". Known formats: ${known}.`);
  }
  return found;
}

// Create the voice folder. Existing files are left alone.
export function init({ name } = {}) {
  const made = [];
  const ensure = (file, text) => {
    if (fs.existsSync(file)) return;
    write(file, text);
    made.push(path.relative(home(), file));
  };
  fs.mkdirSync(p.samples(), { recursive: true });
  fs.mkdirSync(p.drafts(), { recursive: true });
  ensure(p.config(), JSON.stringify({ ...DEFAULT_CONFIG, name: name || '' }, null, 2) + '\n');
  ensure(p.context(), read(path.join(REPO, 'templates', 'context.template.md')));
  ensure(p.topics(), read(path.join(REPO, 'templates', 'topics.template.md')));
  ensure(p.log(), '# Rule changes\n\nEvery change to VOICE.md, newest first, with the draft that caused it.\n');
  return made;
}

export function hasFoundation() {
  return fs.existsSync(p.voice());
}

export function samples() {
  let names = [];
  try {
    names = fs.readdirSync(p.samples());
  } catch {
    return [];
  }
  return names
    .filter((n) => /\.(md|txt)$/i.test(n))
    .sort()
    .map((n) => ({ name: n, text: read(path.join(p.samples(), n)).trim() }))
    .filter((s) => s.text);
}

export function addSamples(texts) {
  const stamp = new Date().toISOString().slice(0, 10);
  let n = samples().length;
  const added = [];
  for (const text of texts) {
    const clean = String(text).trim();
    if (!clean) continue;
    n += 1;
    const name = `${stamp}-sample-${String(n).padStart(2, '0')}.md`;
    write(path.join(p.samples(), name), clean + '\n');
    added.push(name);
  }
  return added;
}

// ---- drafts ----

export function newId(formatId, now = new Date()) {
  const pad = (v) => String(v).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  let id = `${stamp}-${formatId}`;
  let i = 1;
  while (fs.existsSync(path.join(p.drafts(), `${id}.json`))) {
    i += 1;
    id = `${stamp}-${formatId}-${i}`;
  }
  return id;
}

export function today(now = new Date()) {
  const pad = (v) => String(v).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function saveDraft(draft) {
  write(path.join(p.drafts(), `${draft.id}.json`), JSON.stringify(draft, null, 2) + '\n');
  return draft;
}

export function getDraft(id) {
  if (!/^[\w-]+$/.test(String(id))) throw new Error('Bad draft id.');
  const text = read(path.join(p.drafts(), `${id}.json`), null);
  if (text === null) throw new Error(`No draft with id ${id}.`);
  return JSON.parse(text);
}

export function listDrafts() {
  let names = [];
  try {
    names = fs.readdirSync(p.drafts());
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.json'))
    .sort()
    .reverse()
    .map((n) => {
      try {
        return JSON.parse(read(path.join(p.drafts(), n)));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ---- VOICE.md as sections of bullet rules ----

export function parseVoice(text = read(p.voice())) {
  const lines = text.split('\n');
  const sections = [];
  let current = { heading: null, lines: [] };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      sections.push(current);
      current = { heading: m[1], lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections;
}

export function renderVoice(sections) {
  return sections
    .map((s) => (s.heading === null ? s.lines.join('\n') : `## ${s.heading}\n${s.lines.join('\n')}`))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n';
}

export function sectionBullets(heading, text = read(p.voice())) {
  const section = parseVoice(text).find((s) => s.heading && s.heading.toLowerCase() === heading.toLowerCase());
  if (!section) return [];
  return section.lines.filter((l) => /^\s*-\s+/.test(l)).map((l) => l.replace(/^\s*-\s+/, '').trim());
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Apply rule changes to VOICE.md. Returns what happened to each one.
// op: { op: 'add' | 'replace' | 'remove', section, old?, text?, why? }
export function applyOps(ops, text = read(p.voice())) {
  const sections = parseVoice(text);
  const results = [];
  for (const raw of ops || []) {
    const op = { ...raw, op: String(raw.op || '').toLowerCase() };
    const wanted = SECTIONS.find((s) => s.toLowerCase() === String(op.section || '').toLowerCase()) || 'Learned from edits';
    let section = sections.find((s) => s.heading && s.heading.toLowerCase() === wanted.toLowerCase());
    if (!section) {
      section = { heading: wanted, lines: [''] };
      sections.push(section);
    }
    const findOld = () => {
      if (!op.old) return -1;
      const target = norm(op.old.replace(/^\s*-\s+/, ''));
      return section.lines.findIndex((l) => /^\s*-\s+/.test(l) && norm(l.replace(/^\s*-\s+/, '')) === target);
    };
    const clean = (t) => String(t || '').replace(/^\s*-\s+/, '').replace(/\s*\n\s*/g, ' ').trim();
    const append = (t) => {
      while (section.lines.length && section.lines[section.lines.length - 1].trim() === '') section.lines.pop();
      section.lines.push(`- ${t}`, '');
    };
    if (op.op === 'add') {
      const t = clean(op.text);
      if (!t) {
        results.push({ ...op, section: wanted, done: 'skipped', reason: 'empty rule' });
      } else if (section.lines.some((l) => norm(l.replace(/^\s*-\s+/, '')) === norm(t))) {
        results.push({ ...op, section: wanted, done: 'skipped', reason: 'rule already present' });
      } else {
        append(t);
        results.push({ ...op, section: wanted, text: t, done: 'added' });
      }
    } else if (op.op === 'replace') {
      const t = clean(op.text);
      const i = findOld();
      if (!t) {
        results.push({ ...op, section: wanted, done: 'skipped', reason: 'empty rule' });
      } else if (i >= 0) {
        section.lines[i] = `- ${t}`;
        results.push({ ...op, section: wanted, text: t, done: 'replaced' });
      } else {
        append(t);
        results.push({ ...op, section: wanted, text: t, done: 'added', reason: 'old rule not found, added as new' });
      }
    } else if (op.op === 'remove') {
      const i = findOld();
      if (i >= 0) {
        section.lines.splice(i, 1);
        results.push({ ...op, section: wanted, done: 'removed' });
      } else {
        results.push({ ...op, section: wanted, done: 'skipped', reason: 'old rule not found' });
      }
    } else {
      results.push({ ...op, section: wanted, done: 'skipped', reason: `unknown op "${raw.op}"` });
    }
  }
  return { text: renderVoice(sections), results };
}

export function logChanges({ draftId, lessons, results }) {
  const changed = results.filter((r) => r.done !== 'skipped');
  if (!changed.length && !(lessons || []).length) return;
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const body = [`## ${stamp} from draft ${draftId}`, ''];
  for (const l of lessons || []) body.push(`- Lesson: ${l}`);
  for (const r of changed) {
    const what = r.done === 'removed' ? r.old : r.text;
    body.push(`- ${r.done} in "${r.section}": ${what}${r.why ? ` (${r.why})` : ''}`);
  }
  body.push('');
  const existing = read(p.log(), '# Rule changes\n\n');
  const cut = existing.indexOf('\n## ');
  const head = cut === -1 ? existing.trimEnd() + '\n' : existing.slice(0, cut + 1);
  const tail = cut === -1 ? '' : existing.slice(cut + 1);
  write(p.log(), `${head}\n${body.join('\n')}\n${tail}`.replace(/\n{3,}/g, '\n\n'));
}

// ---- topics queue ----

export function nextTopic({ take = false } = {}) {
  const text = read(p.topics());
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^\s*-\s+\[ \]\s+\S/.test(l));
  if (i === -1) return null;
  const topic = lines[i].replace(/^\s*-\s+\[ \]\s+/, '').trim();
  if (take) {
    lines[i] = lines[i].replace('[ ]', '[x]');
    write(p.topics(), lines.join('\n'));
  }
  return topic;
}
