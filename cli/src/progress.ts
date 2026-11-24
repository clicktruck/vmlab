// What a person sees while a run goes on. Each milestone gets a line stamped with the time it began (since the run
// started). On a terminal, the step that is working shows a spinner at the left of its text, and the line is
// rewritten with a tick and its duration when the step ends. Without a terminal (a log, CI, a pipe) there is no
// spinner: a line when a step starts and a line when it ends. The same steps and timings are kept, in order, for the
// run record. Nothing here holds a secret: callers pass plain labels, and the record is checked for secrets.

export type TimelineEntry = {
  label: string;
  /** The machine profile it belongs to, when it belongs to one. */
  profile?: string;
  /** 0 for a run-level step, 1 for a step inside it. */
  level: number;
  startedAt: string;
  seconds: number;
  ok: boolean;
};

export type StepOptions = { profile?: string; level?: number };

export interface Reporter {
  /** Runs `fn`, showing its start, its end and its duration, and recording it. A failure is shown and rethrown. */
  timed<T>(label: string, fn: () => Promise<T>, opts?: StepOptions): Promise<T>;
  /** A plain line, with the time. */
  info(message: string, opts?: StepOptions): void;
  timeline(): TimelineEntry[];
}

/** 4.2s, 59.9s, 1m05s, 12m30s. */
export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}m${String(s).padStart(2, '0')}s`;
}

function clock(seconds: number): string {
  const t = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
/** Back to the start of the line and clear it. */
const REWRITE = '\r\x1b[2K';

export type ReporterOptions = {
  /** Where output goes. Nothing means silence (the timeline is still kept). */
  write?: (text: string) => void;
  now?: () => number;
  /** Draw a spinner and rewrite lines in place. True only on a terminal. */
  spinner?: boolean;
  frameMs?: number;
  /** The width of the terminal. A line being redrawn is cut to fit, because a wrapped line cannot be redrawn. */
  columns?: () => number | undefined;
};

type Step = {
  label: string;
  opts: StepOptions;
  started: number;
  stamp: string;
  frame: number;
  timer?: ReturnType<typeof setInterval>;
};

export class StepReporter implements Reporter {
  private readonly write: (text: string) => void;
  private readonly now: () => number;
  private readonly spinner: boolean;
  private readonly frameMs: number;
  private readonly columns: () => number | undefined;
  private readonly t0: number;
  private readonly entries: TimelineEntry[] = [];
  /** The step whose line is being redrawn: the one that is working now. */
  private active: Step | null = null;

  constructor(opts: ReporterOptions = {}) {
    this.write = opts.write ?? (() => {});
    this.now = opts.now ?? Date.now;
    this.spinner = opts.spinner ?? false;
    this.frameMs = opts.frameMs ?? 100;
    this.columns = opts.columns ?? (() => undefined);
    this.t0 = this.now();
  }

  private text(stamp: string, mark: string, label: string, opts: StepOptions, tail = ''): string {
    const where = opts.profile ? `${opts.profile}: ` : '';
    return `[${stamp}] ${'  '.repeat(opts.level ?? 0)}${mark} ${where}${label}${tail}`;
  }

  /** A line that is redrawn must stay on one row: a row that wraps cannot be cleared by going back to its start. */
  private fit(line: string): string {
    const width = this.columns();
    if (!width || width < 12) return line;
    const chars = Array.from(line);
    return chars.length <= width - 1 ? line : `${chars.slice(0, width - 2).join('')}…`;
  }

  private stampNow(): string {
    return clock((this.now() - this.t0) / 1000);
  }

  /** A step that is working but is not the newest one stops spinning and keeps its line. */
  private freezeActive() {
    const step = this.active;
    if (!step) return;
    if (step.timer) clearInterval(step.timer);
    this.write(`${REWRITE}${this.fit(this.text(step.stamp, '▸', step.label, step.opts))}\n`);
    this.active = null;
  }

  info(message: string, opts: StepOptions = {}): void {
    this.freezeActive();
    this.write(`${this.text(this.stampNow(), '-', message, opts)}\n`);
  }

  async timed<T>(label: string, fn: () => Promise<T>, opts: StepOptions = {}): Promise<T> {
    const started = this.now();
    const step: Step = { label, opts, started, stamp: this.stampNow(), frame: 0 };
    if (this.spinner) {
      this.freezeActive();
      this.active = step;
      const draw = () => {
        this.write(
          `${REWRITE}${this.fit(this.text(step.stamp, FRAMES[step.frame++ % FRAMES.length] as string, label, opts))}`,
        );
      };
      draw();
      step.timer = setInterval(draw, this.frameMs);
    } else {
      this.write(`${this.text(step.stamp, '>', label, opts)}\n`);
    }
    let ok = false;
    try {
      const result = await fn();
      ok = true;
      return result;
    } finally {
      const seconds = (this.now() - started) / 1000;
      const tail = ` (${formatSeconds(seconds)})`;
      if (this.spinner) {
        if (step.timer) clearInterval(step.timer);
        const line = this.text(step.stamp, ok ? '✔' : '✖ FAILED:', label, opts, tail);
        // The working step redraws its own line; a step that was frozen earlier adds a new line.
        this.write(`${this.active === step ? REWRITE : ''}${line}\n`);
        if (this.active === step) this.active = null;
      } else {
        this.write(`${this.text(step.stamp, ok ? 'done:' : 'FAILED:', label, opts, tail)}\n`);
      }
      this.entries.push({
        label,
        ...(opts.profile ? { profile: opts.profile } : {}),
        level: opts.level ?? 0,
        startedAt: new Date(started).toISOString(),
        seconds: Math.round(seconds * 10) / 10,
        ok,
      });
    }
  }

  timeline(): TimelineEntry[] {
    return [...this.entries];
  }
}

/** Keeps the timeline, prints nothing. For tests and for `--json`. */
export const quiet = (): Reporter => new StepReporter();
