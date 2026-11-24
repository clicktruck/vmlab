// The one interface a cloud implements. Nothing outside a provider names a cloud (AGENTS.md).
import type { Profile } from './schema.ts';

export type Machine = { id: string; profile: string };

export type Script = { name: string; content: string };

/** Values handed to a script by name. Protected ones are encrypted in transit and never shown or logged. */
export type ScriptInputs = {
  parameters?: Record<string, string>;
  protectedParameters?: Record<string, string>;
};

export type ExecResult = {
  /** False when nothing was run (the dry provider): the result is a gap, never a pass. */
  ran: boolean;
  exitCode: number;
  output: string;
};

/** What a run needs from the world, passed to the provider so it can tag what it makes. */
export type RunContext = {
  runId: string;
  expiresAt: Date;
  tags: Record<string, string>;
  /** Set only when the person has attested the licence the profile requires. */
  licenceType: 'included' | 'Windows_Client';
};

export interface Provider {
  readonly name: string;
  /** Plain lines saying what `up` would make. Makes nothing. */
  plan(profile: Profile, ctx: RunContext): string[];
  up(profile: Profile, ctx: RunContext): Promise<Machine>;
  exec(
    machine: Machine,
    script: Script,
    runAs: string,
    timeoutSeconds: number,
    inputs?: ScriptInputs,
  ): Promise<ExecResult>;
  /** Puts a file from this computer onto the machine. `ran` is false when nothing was copied (the dry provider). */
  putFile(machine: Machine, localPath: string, remotePath: string): Promise<{ ran: boolean }>;
  /** Brings a file, or a folder's contents as a .zip, from the machine to this computer. */
  getFile(machine: Machine, remotePath: string, localPath: string): Promise<{ ran: boolean }>;
  /** Makes the exchange (storage for files and whole outputs) for this machine now, so the first use is not slow. */
  prepareExchange(machine: Machine): Promise<void>;
  /** Restarts the machine and waits until it can run scripts again. `ran` is false when nothing was restarted (the dry provider). */
  reboot(machine: Machine, timeoutSeconds: number): Promise<{ ran: boolean }>;
  down(machine: Machine): Promise<void>;
  /** Optional: the hourly price of the profile's machine, from the cloud's own price list. Null when unknown. */
  estimate?(profile: Profile): Promise<number | null>;
  /** Deletes what this provider made that is past its expiry. Returns what it deleted. */
  sweep(now: Date): Promise<string[]>;
}
