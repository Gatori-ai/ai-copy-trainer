#!/usr/bin/env node
// A stand-in writer for the demo. It reads the prompt and prints a canned
// answer, so the whole loop can be tried with no model and no account.
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (prompt += d));
process.stdin.on('end', () => {
  const out = (s) => process.stdout.write(s);

  if (prompt.startsWith('Build the voice rules')) {
    return out(`<voice_md>
# Voice rules: Maya

Load this file before writing anything a reader will see. \`rules/ai-tells.md\` applies as well; a tell listed under "Allowed exceptions" below is allowed.

## Rhythm

- Open on the thing that happened, with no warm-up: "Third bowl collapsed today."
- Two or three short sentences, then one that runs longer: "You wedge it, you start again, and the next one already knows something."
- Short paragraphs with a blank line between them.

## Words I use

- "flop" ("Wet flop, right there on the wheel")
- "mud" ("six weeks, lots of mud")
- "wedge", "trim", "kiln" as plain working words, never explained
- "Honestly" to start an admission ("Honestly it looks better with a crack.")

## Words I never use

- \`journey\`
- \`mindful\`
- \`craft your\`
- \`artisan\`

## Signature moves

- Admit a failure of my own before teaching anything: "I trimmed through the bottom of a pot on Tuesday."
- Give the clay a personality: "Clay doesn't hold a grudge."
- Invite people in with a joke at my own expense: "Come flop with us."

## Humor

- Dry, aimed at myself and at the clay. Never at a student.

## How I sell

- One plain line at the end with the facts: "Eight seats, six weeks, lots of mud."

## By format

- Instagram: under 60 words, ends on the invitation.
- Email: opens "Hi friend," and tells one small story from the week.

## Allowed exceptions

## Learned from edits
</voice_md>`);
  }

  if (prompt.startsWith('A person reviewed')) {
    return out(JSON.stringify({
      lessons: [
        'Maya signs emails with her first name only, with no closing line before it.',
        'She names the day something happened.',
      ],
      operations: [
        { op: 'add', section: 'By format', text: 'Email: sign off with "Maya" alone. No "Warmly" or "See you soon" above it.', why: 'she cut the closing line' },
        { op: 'add', section: 'Learned from edits', text: 'Name the day. "On Friday" beats "recently".', why: 'she changed "the other day" to "on Wednesday"' },
      ],
    }));
  }

  if (prompt.startsWith('This draft breaks')) {
    const m = prompt.match(/<draft>([\s\S]*?)<\/draft>/);
    return out(`<draft>${m ? m[1] : ''}</draft>`);
  }

  const topic = (prompt.match(/^Topic: (.+)$/m) || [])[1] || 'the first pot is always ugly';
  const rewrite = prompt.includes('<note>');
  if (/^Write one email/.test(prompt)) {
    return out(`<topic>${topic}</topic>
<draft>
Subject: your first pot will be ugly

Hi friend,

${rewrite ? 'On Wednesday a' : 'The other day a'} new student held up her first pot and apologised to it.

It leaned to the left and had a wall you could read a newspaper through. I told her mine looked worse. I still have it. It lives under the sink and holds the sponge.

The ugly one is the one that teaches your hands where the middle is. You can't skip it, and honestly I wouldn't want you to.

New beginner course starts on [FILL IN: start date]. Eight seats, six weeks, lots of mud.

${rewrite ? 'Maya' : 'See you soon,\nMaya'}
</draft>`);
  }
  return out(`<topic>${topic}</topic>
<draft>
Your first pot will lean. Mine is under the sink holding a sponge.

Eleven years in and I still say hi to it.

Two seats left on Thursday. Come make an ugly one.
</draft>`);
});
