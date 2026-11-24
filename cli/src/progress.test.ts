import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatSeconds, StepReporter } from './progress.ts';

/** A reporter with a clock the test moves by hand, writing into an array. */
function fake(spinner = false) {
  let ms = 1_000_000;
  const out: string[] = [];
  const reporter = new StepReporter({ write: (t) => out.push(t), now: () => ms, spinner, frameMs: 5 });
  return { reporter, out, text: () => out.join(''), advance: (s: number) => (ms += s * 1000) };
}

test('seconds are written for people: 4.2s, then 1m05s', () => {
  assert.equal(formatSeconds(4.24), '4.2s');
  assert.equal(formatSeconds(59.94), '59.9s');
  assert.equal(formatSeconds(65), '1m05s');
  assert.equal(formatSeconds(750), '12m30s');
});

test('without a terminal: a line when a step starts, stamped with its time, and a line when it ends with how long it took', async () => {
  const { reporter, text, advance } = fake();
  advance(7);
  await reporter.timed('creating the VM', async () => advance(252), { profile: 'windows-11', level: 1 });
  assert.equal(
    text(),
    '[00:00:07]   > windows-11: creating the VM\n[00:00:07]   done: windows-11: creating the VM (4m12s)\n',
  );
});

test('there is no "still working" line, however long a step takes', async () => {
  const { reporter, text } = fake();
  await reporter.timed('slow', () => new Promise<void>((r) => setTimeout(r, 40)));
  assert.equal(/still working/.test(text()), false);
});

test('a failing step says FAILED with its time, and the error still reaches the caller', async () => {
  const { reporter, text, advance } = fake();
  await assert.rejects(
    reporter.timed('deleting', async () => {
      advance(3);
      throw new Error('no');
    }),
    /no/,
  );
  assert.match(text(), /FAILED: deleting \(3\.0s\)/);
  assert.equal(reporter.timeline()[0]?.ok, false);
});

test('on a terminal the working step shows a spinner at the left of its text, and the line ends with a tick and its time', async () => {
  const { reporter, text } = fake(true);
  await reporter.timed('creating the VM', () => new Promise<void>((r) => setTimeout(r, 40)), {
    profile: 'p',
  });
  // Each redraw starts by going back to the start of the line and clearing it; show those as line breaks to read them.
  const lines = text().split('\r\x1b[2K');
  assert.ok(lines.length > 2, 'the line was redrawn');
  assert.match(
    lines[1] ?? '',
    /^\[00:00:00\] [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] p: creating the VM$/,
    'a spinner frame, then the label',
  );
  assert.match(
    lines.at(-1) ?? '',
    /^\[00:00:00\] ✔ p: creating the VM \(\d.*\)\n$/,
    'the same line, ending with a tick and the time',
  );
});

test('on a narrow terminal the spinner line is cut to fit one row, so it never wraps and smears', async () => {
  const ms = 1_000_000;
  const out: string[] = [];
  const r = new StepReporter({
    write: (t) => out.push(t),
    now: () => ms,
    spinner: true,
    frameMs: 5,
    columns: () => 40,
  });
  await r.timed(
    'sending 01-experiments.ps1 to the machine and waiting for it to finish (as admin)',
    () => new Promise<void>((x) => setTimeout(x, 20)),
    { profile: 'windows-11', level: 1 },
  );
  const drawn = out.join('').split('\r\x1b[2K').slice(1, -1);
  assert.ok(drawn.length > 0);
  for (const line of drawn)
    assert.ok(Array.from(line).length <= 39, `${Array.from(line).length} wide: ${line}`);
  assert.ok(drawn[0]?.endsWith('…'));
  // The finished line is permanent and is not cut.
  assert.match(
    out.join(''),
    /✔ windows-11: sending 01-experiments\.ps1 to the machine and waiting for it to finish \(as admin\)/,
  );
});

test('on a terminal the spinner stops when the step ends', async () => {
  const { reporter, out } = fake(true);
  await reporter.timed('quick', async () => {});
  const before = out.length;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(out.length, before);
});

test('a step with a step inside it: the outer one keeps its line when the inner one starts, and gets a tick when it ends', async () => {
  const { reporter, text } = fake(true);
  await reporter.timed('outer', async () => {
    await reporter.timed('inner', async () => {}, { level: 1 });
  });
  const t = text();
  assert.match(t, /▸ outer\n/, 'the outer step stops spinning and stays as a line');
  assert.match(t, /\[00:00:00\] {3}✔ inner \(/);
  assert.match(t, /\n\[00:00:00\] ✔ outer \(/, 'its tick is a new line stamped with when it began');
});

test('an info line stops the spinner first, so lines never overwrite one another', async () => {
  const { reporter, text } = fake(true);
  await reporter.timed('work', async () => {
    reporter.info('a note');
  });
  assert.match(text(), /▸ work\n\[00:00:00\] - a note\n/);
});

test('the timeline keeps every step in order, with its profile and level', async () => {
  const { reporter, advance } = fake();
  await reporter.timed('a', async () => advance(1), { profile: 'p', level: 0 });
  await reporter.timed('b', async () => advance(2), { profile: 'p', level: 1 });
  assert.deepEqual(
    reporter.timeline().map((e) => [e.label, e.profile, e.level, e.seconds, e.ok]),
    [
      ['a', 'p', 0, 1, true],
      ['b', 'p', 1, 2, true],
    ],
  );
});

test('with no writer nothing is printed, but the timeline is still kept', async () => {
  const quiet = new StepReporter();
  await quiet.timed('x', async () => {});
  assert.equal(quiet.timeline().length, 1);
});
