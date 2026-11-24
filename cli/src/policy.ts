// What a run may fetch. Deny by default: a source is used only when a rule allows it (docs/03).
import type { RootConfig } from './schema.ts';

/** `*` stays inside one path segment, `**` crosses them. A lone `*` matches anything (used for refs). */
export function globToRegExp(pattern: string, anything = false): RegExp {
  if (anything && pattern === '*') return /^.*$/;
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charAt(i);
    if (c === '*') {
      if (pattern.charAt(i + 1) === '*') {
        out += '.*';
        i++;
      } else out += '[^/]*';
    } else out += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/** `repo` is owner/name on github.com; rules are written as github.com/owner/name. */
export function sourceAllowed(allow: string[], repo: string): boolean {
  return allow.some((rule) => globToRegExp(rule).test(`github.com/${repo}`));
}

export function refAllowed(patterns: string[], ref: string): boolean {
  return patterns.some((p) => globToRegExp(p, true).test(ref));
}

export function checkSource(
  policy: RootConfig['policy']['sources'],
  repo: string,
  ref: string,
): string | null {
  if (!sourceAllowed(policy.allow, repo)) {
    return `source github.com/${repo} is not allowed: no rule in policy.sources.allow matches it (the default allows nothing)`;
  }
  if (!refAllowed(policy.refs, ref)) return `ref "${ref}" of ${repo} is not allowed by policy.sources.refs`;
  return null;
}
