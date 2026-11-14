#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../src/store.mjs';
import * as engine from '../src/engine.mjs';
import { lint } from '../src/lint.mjs';
import { notify } from '../src/notify.mjs';
import * as schedule from '../src/schedule.mjs';
import { serve } from '../src/server.mjs';
import { resolveProvider } from '../src/writer.mjs';

const HELP = `AI Copy Trainer

  trainer init [--name "Your Name"]        create the voice folder
  trainer foundation                       build voice/VOICE.md from context.md and samples/
  trainer draft [--format id] [--topic "..."]   write one draft now
  trainer list                             show drafts, newest first
  trainer show <id>                        print one draft
  trainer accept <id> [--file edited.txt] [--note "..."]
  trainer reject <id> --note "..."
  trainer rewrite <id> [--file edited.txt] --note "..."
  trainer daily [--force]                  today's draft, once per day, with a notification
  trainer serve [--port 4747]              the local page with the New draft button
  trainer schedule install [--time 08:00] [--dry-run]
  trainer schedule remove
  trainer check <file>                     mechanical check of any text against the rules
  trainer status
  trainer demo [--port 4747]             try the page with a sample person and no model

Formats: ${safeFormats()}
`;

function safeFormats() {
  try {
    return store.formats().map((f) => f.id).join(', ');
  } catch {
    return 'tweet, thread, linkedin-post, instagram-caption, email-broadcast, long-form';
  }
}

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i += 1;
      }
    } else out._.push(a);
  }
  return out;
}

function printDraft(d) {
  console.log(`\n[${d.id}] ${d.format} | ${d.status} | ${d.topic}\n`);
  console.log(d.final || d.draft);
  if (d.problems?.length) console.log(`\nStill flagged: ${d.problems.map((x) => x.term).join(', ')}`);
  console.log('');
}

function printLearned(item) {
  if (item.learnError) console.log(item.learnError);
  for (const l of item.lessons || []) console.log(`Learned: ${l}`);
  for (const c of item.changes || []) console.log(`Rule ${c.done} in "${c.section}": ${c.done === 'removed' ? c.old : c.text}`);
  if (!item.lessons?.length && !item.changes?.length && !item.learnError) console.log('No rule changes.');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = args(rest);
  const fileText = () => (a.file ? fs.readFileSync(String(a.file), 'utf8') : undefined);
  const note = typeof a.note === 'string' ? a.note : undefined;

  switch (cmd) {
    case 'init': {
      const made = store.init({ name: typeof a.name === 'string' ? a.name : '' });
      console.log(made.length ? `Created in ${store.home()}: ${made.join(', ')}` : `Already set up at ${store.home()}.`);
      console.log('Next: fill in context.md, put 10 to 20 pieces of your own writing in samples/, then run "trainer foundation".');
      break;
    }
    case 'foundation': {
      store.init();
      console.log(`Reading samples with ${resolveProvider()}...`);
      const r = await engine.foundation();
      console.log(`Wrote ${r.file} from ${r.samples} samples. Read it and correct anything that is not you.`);
      break;
    }
    case 'draft': {
      console.log(`Writing with ${resolveProvider()}...`);
      printDraft(await engine.draft({ format: a.format, topic: a.topic, source: 'cli' }));
      break;
    }
    case 'list': {
      for (const d of store.listDrafts().slice(0, 40)) console.log(`${d.id}  ${d.status.padEnd(9)}  ${d.topic}`);
      break;
    }
    case 'show':
      printDraft(store.getDraft(a._[0]));
      break;
    case 'accept':
    case 'reject':
    case 'rewrite': {
      const r = await engine.feedback({ id: a._[0], action: cmd, final: fileText(), note });
      console.log(`Draft ${r.item.id} ${r.item.status}.`);
      printLearned(r.item);
      if (r.next) printDraft(r.next);
      break;
    }
    case 'daily': {
      const r = await engine.daily({ force: Boolean(a.force) });
      if (!r.made) {
        console.log(`Today's draft already exists: ${r.item.id}`);
        break;
      }
      const port = store.loadConfig().port;
      const sent = await notify({
        title: 'New draft in your voice',
        body: `${r.item.topic} (${r.item.format})`,
        url: `http://localhost:${port}/`,
      });
      console.log(`Wrote ${r.item.id}. Notified by: ${sent.join(', ') || 'nothing'}.`);
      break;
    }
    case 'demo': {
      // A copy of demo/voice in a temp folder, written by the canned demo writer.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-copy-trainer-demo-'));
      fs.cpSync(path.join(store.REPO, 'demo', 'voice'), dir, { recursive: true });
      process.env.VOICE_HOME = dir;
      store.init({ name: 'Maya' });
      const config = store.loadConfig();
      config.name = 'Maya';
      config.formats = ['email-broadcast', 'instagram-caption'];
      config.daily.enabled = false;
      config.notify.desktop = false;
      config.writer = { provider: 'command', model: null, command: `"${process.execPath}" "${path.join(store.REPO, 'demo', 'writer.mjs')}"` };
      store.saveConfig(config);
      console.log('Demo mode: a sample person, canned drafts, no model. Nothing here is saved.');
      serve({ port: a.port });
      break;
    }
    case 'serve':
      serve({ port: a.port });
      break;
    case 'schedule': {
      if (a._[0] === 'remove') {
        const r = schedule.remove();
        console.log(r.removed ? `Removed ${r.file}.` : r.note || 'No schedule was installed.');
        break;
      }
      if (a._[0] !== 'install') throw new Error('Use: trainer schedule install | remove');
      const time = typeof a.time === 'string' ? a.time : undefined;
      const r = schedule.install({ time, dryRun: Boolean(a['dry-run']) });
      if (time) {
        const config = store.loadConfig();
        config.daily.time = time;
        store.saveConfig(config);
      }
      if (r.kind === 'launchd' && r.installed) console.log(`Daily draft scheduled for ${String(r.hour).padStart(2, '0')}:${String(r.minute).padStart(2, '0')}. Job file: ${r.file}`);
      else if (r.kind === 'launchd') console.log(`Dry run. Would write ${r.file}:\n\n${r.content}`);
      else console.log(`Add this line to your scheduler:\n\n${r.line}\n`);
      break;
    }
    case 'check': {
      const text = fs.readFileSync(String(a._[0]), 'utf8');
      const found = lint(text);
      if (!found.length) console.log('Mechanical pass clean. The sentence shapes in rules/ai-tells.md still need a read.');
      for (const f of found) console.log(`${f.kind}: ${f.term} (${f.count}). ${f.fix}`);
      process.exitCode = found.length ? 1 : 0;
      break;
    }
    case 'status': {
      const s = engine.status();
      console.log(JSON.stringify({ ...s, home: store.home(), schedule: schedule.installed() }, null, 2));
      break;
    }
    default:
      console.log(HELP);
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
