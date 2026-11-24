// The shape of every file vmlab reads. These zod schemas are the one source: the JSON Schemas in schema/ are
// made from them (`just schema`), so an editor can check a file as you type, and a test fails if schema/ is stale.
import { z } from 'zod';

const name = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'use lower-case letters, digits and dashes');

/** A statement only the person can make. vmlab cannot check it; it records what was set and the note. */
const attestation = z
  .object({
    holds_eligible_licence: z.boolean(),
    /** An identifier you can show an auditor, such as a support case number or an email's date and subject. */
    reference: z.string(),
    note: z.string(),
  })
  .strict();

export const Attestations = z.object({ windows_client_licence: attestation }).strict();
export type AttestationName = keyof z.infer<typeof Attestations>;

export const RootConfig = z
  .object({
    version: z.literal(1),
    config_dirs: z.array(z.string().min(1)).min(1),
    provider: z
      .object({
        name: z.enum(['azure', 'dry']),
        azure: z
          .object({
            subscription: z.string().nullable(),
            location: z.string().min(1),
            resource_group_prefix: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/),
          })
          .strict(),
      })
      .strict(),
    default_profile: name,
    lifetime: z
      .object({
        ttl_minutes: z.number().int().positive(),
        delete: z.enum(['always', 'on_success', 'never']),
      })
      .strict(),
    budget: z.object({ max_estimated_usd: z.number().positive() }).strict(),
    attestations: Attestations,
    policy: z
      .object({
        sources: z.object({ allow: z.array(z.string()), refs: z.array(z.string()) }).strict(),
      })
      .strict(),
    tags: z.record(z.string(), z.string()),
  })
  .strict();
export type RootConfig = z.infer<typeof RootConfig>;

export const Profile = z
  .object({
    name,
    description: z.string(),
    os: z.enum(['windows', 'linux']),
    image: z.string().min(1),
    size: z.string().min(1),
    disk: z.string().min(1),
    /** Optional. Without it a plan says the cost is unknown (a gap), never zero. */
    estimated_usd_per_hour: z.number().positive().optional(),
    network: z.object({ public_ip: z.boolean(), inbound: z.array(z.string()) }).strict(),
    licence: z
      .object({
        type: z.enum(['included', 'Windows_Client']),
        requires_attestation: z.enum(['windows_client_licence']).optional(),
      })
      .strict(),
  })
  .strict();
export type Profile = z.infer<typeof Profile>;

const expect = z
  .object({
    exit_code: z.number().int().optional(),
    output_contains: z.array(z.string()).optional(),
    output_not_contains: z.array(z.string()).optional(),
    output_matches: z.array(z.string()).optional(),
  })
  .strict();
export type Expect = z.infer<typeof expect>;

const runAs = z
  .string()
  .regex(/^(admin|system|(user|session):[A-Za-z0-9_.-]+)$/, 'admin, system, user:NAME or session:NAME');

const ScriptStep = z
  .object({
    id: name,
    script: z.string().min(1),
    run_as: z.array(runAs).min(1),
    timeout_seconds: z.number().int().positive(),
    /** The suite inputs this script takes, by name. Its `param(...)` block must declare them. */
    inputs: z.array(z.string()).optional(),
    expect,
  })
  .strict();

/** Restart the machine and wait until it answers again, for example after installing something that needs it. */
const RebootStep = z
  .object({
    id: name,
    kind: z.literal('reboot'),
    timeout_seconds: z.number().int().positive(),
  })
  .strict();

/** A value a suite's scripts take, by name. A secret one is never written in a file: the run names an environment variable. */
const SuiteInput = z
  .object({
    description: z.string().optional(),
    default: z.string().optional(),
    secret: z.boolean().optional(),
  })
  .strict();
export type SuiteInput = z.infer<typeof SuiteInput>;

export const Suite = z
  .object({
    name,
    description: z.string(),
    os: z.enum(['windows', 'linux']),
    needs: z.object({ sources: z.array(z.string()) }).strict(),
    inputs: z
      .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'a PowerShell-safe name'), SuiteInput)
      .optional(),
    steps: z.array(z.union([RebootStep, ScriptStep])).min(1),
  })
  .strict();
export type Suite = z.infer<typeof Suite>;
export type ScriptStepT = z.infer<typeof ScriptStep>;
export type RebootStepT = z.infer<typeof RebootStep>;
/** A step that runs a script, as opposed to one that restarts the machine. */
export const isScriptStep = (step: Suite['steps'][number]): step is ScriptStepT => !('kind' in step);

export const Source = z
  .object({
    name,
    type: z.literal('git-github'),
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'owner/name'),
    default_ref: z.string().min(1),
    auth: z
      .object({ token_env: z.string().regex(/^[A-Z_][A-Z0-9_]*$/, 'an environment variable name') })
      .strict()
      .nullable(),
  })
  .strict();
export type Source = z.infer<typeof Source>;

const FileIn = z.object({ from: z.string().min(1), to: z.string().min(1) }).strict();
const FileOut = z
  .object({
    from: z.string().min(1),
    /** A name, not a path: the file or folder is saved as runs/<id>/files/<profile>/<to>. */
    to: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'a plain file name'),
  })
  .strict();

export const Run = z
  .object({
    name,
    description: z.string(),
    /**
     * Files to put on each machine before the suites run (`in`: a path inside the project, and where it goes on the
     * machine) and to bring back after (`out`: a path on the machine, and a name to save it as). A folder comes back
     * as its contents. Needs the exchange: a small storage area made inside the run's resource group and deleted with it.
     */
    files: z
      .object({ in: z.array(FileIn).optional(), out: z.array(FileOut).optional() })
      .strict()
      .optional(),
    /** Make the exchange even with no files, so a script's output comes back whole and not cut at 4 KB. */
    exchange: z.boolean().optional(),
    profiles: z.array(name).min(1),
    sources: z.array(z.object({ name, ref: z.string().min(1).optional() }).strict()),
    suites: z.array(z.object({ name, inputs: z.record(z.string(), z.string()).optional() }).strict()).min(1),
  })
  .strict();
export type Run = z.infer<typeof Run>;

/** The schemas that get a published JSON Schema, by file name in schema/. */
export const published = {
  'vmlab.schema.json': RootConfig,
  'profile.schema.json': Profile,
  'suite.schema.json': Suite,
  'source.schema.json': Source,
  'run.schema.json': Run,
} as const;

export function jsonSchemas(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [file, schema] of Object.entries(published)) out[file] = z.toJSONSchema(schema);
  return out;
}
