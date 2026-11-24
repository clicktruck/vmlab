// The fake provider: makes nothing, runs nothing, and says so. Every unit test uses it (or a test double).
import type { ExecResult, Machine, Provider, RunContext, Script } from '../provider.ts';
import type { Profile } from '../schema.ts';

export class DryProvider implements Provider {
  readonly name = 'dry';
  readonly calls: string[] = [];

  plan(profile: Profile, ctx: RunContext): string[] {
    return [
      `would make one ${profile.os} machine "${profile.name}" (${profile.image}, size ${profile.size})`,
      `would tag everything with run ${ctx.runId} and expiry ${ctx.expiresAt.toISOString()}`,
      `would delete it when the run ends`,
    ];
  }

  async up(profile: Profile): Promise<Machine> {
    this.calls.push(`up ${profile.name}`);
    return { id: `dry-${profile.name}`, profile: profile.name };
  }

  async exec(machine: Machine, script: Script, runAs: string): Promise<ExecResult> {
    this.calls.push(`exec ${machine.id} ${script.name} as ${runAs}`);
    return { ran: false, exitCode: 0, output: '(dry provider: nothing was run)' };
  }

  async putFile(machine: Machine, localPath: string, remotePath: string): Promise<{ ran: boolean }> {
    this.calls.push(`putFile ${machine.id} ${localPath} -> ${remotePath}`);
    return { ran: false };
  }

  async getFile(machine: Machine, remotePath: string, localPath: string): Promise<{ ran: boolean }> {
    this.calls.push(`getFile ${machine.id} ${remotePath} -> ${localPath}`);
    return { ran: false };
  }

  async prepareExchange(machine: Machine): Promise<void> {
    this.calls.push(`prepareExchange ${machine.id}`);
  }

  async reboot(machine: Machine): Promise<{ ran: boolean }> {
    this.calls.push(`reboot ${machine.id}`);
    return { ran: false };
  }

  async down(machine: Machine): Promise<void> {
    this.calls.push(`down ${machine.id}`);
  }

  async sweep(): Promise<string[]> {
    this.calls.push('sweep');
    return [];
  }
}
