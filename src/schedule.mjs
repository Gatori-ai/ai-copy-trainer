// Run "trainer daily" every day, page open or closed.
// macOS: a LaunchAgent. Linux: a crontab line to paste. Windows: a Task Scheduler line.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, home, loadConfig } from './store.mjs';

function label() {
  const hash = crypto.createHash('sha1').update(home()).digest('hex').slice(0, 8);
  return `ai.gatori.copy-trainer.${hash}`;
}

function plistPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${label()}.plist`);
}

function parseTime(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || '');
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`"${time}" is not a time. Use HH:MM, such as 08:00.`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function plan({ time } = {}) {
  const config = loadConfig();
  const { hour, minute } = parseTime(time || config.daily.time);
  const script = path.join(REPO, 'bin', 'trainer.mjs');
  const logFile = path.join(home(), '.server.log');
  if (process.platform === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label()}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(script)}</string>
    <string>daily</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>VOICE_HOME</key><string>${xml(home())}</string>
    <key>PATH</key><string>${xml(process.env.PATH || '/usr/local/bin:/usr/bin:/bin')}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
  <key>StandardOutPath</key><string>${xml(logFile)}</string>
  <key>StandardErrorPath</key><string>${xml(logFile)}</string>
</dict>
</plist>
`;
    return { kind: 'launchd', file: plistPath(), content: plist, hour, minute };
  }
  const cmd = `VOICE_HOME="${home()}" "${process.execPath}" "${script}" daily >> "${logFile}" 2>&1`;
  if (process.platform === 'win32') {
    return {
      kind: 'manual',
      line: `schtasks /Create /SC DAILY /ST ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} /TN AICopyTrainer /TR "\\"${process.execPath}\\" \\"${script}\\" daily"`,
      hour,
      minute,
    };
  }
  return { kind: 'manual', line: `${minute} ${hour} * * * ${cmd}`, hour, minute };
}

export function install({ time, dryRun = false } = {}) {
  const job = plan({ time });
  if (job.kind !== 'launchd' || dryRun) return { ...job, installed: false };
  fs.mkdirSync(path.dirname(job.file), { recursive: true });
  const uid = process.getuid();
  spawnSync('launchctl', ['bootout', `gui/${uid}/${label()}`]);
  fs.writeFileSync(job.file, job.content);
  const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, job.file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`launchctl could not load ${job.file}: ${(r.stderr || '').trim()}`);
  return { ...job, installed: true };
}

export function remove() {
  if (process.platform !== 'darwin') return { removed: false, note: 'Remove the crontab or Task Scheduler entry by hand.' };
  const file = plistPath();
  spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${label()}`]);
  const existed = fs.existsSync(file);
  if (existed) fs.rmSync(file);
  return { removed: existed, file };
}

export function installed() {
  return process.platform === 'darwin' && fs.existsSync(plistPath()) ? plistPath() : null;
}
