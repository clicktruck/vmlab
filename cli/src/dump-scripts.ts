// Writes the PowerShell that vmlab builds in TypeScript to scratch/gen-*.ps1, so `just lint-ps` can check that it parses.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DOWNLOAD_SCRIPT, UPLOAD_SCRIPT } from './providers/azure-exchange.ts';
import { buildRunAsUserScript, CREATE_USER_SCRIPT } from './providers/windows-user-task.ts';
import { FETCH_SOURCE_SCRIPT } from './sources.ts';

const root = process.env.VMLAB_ROOT ?? '/project';
const out = path.join(root, 'scratch');
mkdirSync(out, { recursive: true });
const scripts: Record<string, string> = {
  'gen-wrapper.ps1': buildRunAsUserScript('02-protect.ps1', 'Write-Output hi'),
  'gen-create-user.ps1': CREATE_USER_SCRIPT,
  'gen-download.ps1': DOWNLOAD_SCRIPT,
  'gen-upload.ps1': UPLOAD_SCRIPT,
  'gen-fetch-source.ps1': FETCH_SOURCE_SCRIPT,
};
for (const [name, text] of Object.entries(scripts)) writeFileSync(path.join(out, name), text);
console.log(`wrote ${Object.keys(scripts).length} scripts to ${out}`);

// The C# that suite scripts hand to Add-Type, pulled out so `just lint-ps` can compile it with the language level
// Windows PowerShell 5.1 has (C# 5). Compile only: the Windows libraries it calls are not there to run it.

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ps1') ? [path.join(dir, e.name)] : [],
  );
}
const cs = path.join(out, 'cs');
rmSync(cs, { recursive: true, force: true });
mkdirSync(cs, { recursive: true });
let blocks = 0;
for (const file of walk(path.join(root, 'config'))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/Add-Type -TypeDefinition @['"]\r?\n([\s\S]*?)\r?\n['"]@/g)) {
    blocks += 1;
    writeFileSync(path.join(cs, `Block${blocks}.cs`), `// from ${path.relative(root, file)}\n${m[1]}\n`);
  }
}
writeFileSync(
  path.join(cs, 'Check.csproj'),
  `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <OutputType>Library</OutputType>
    <LangVersion>5</LangVersion>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
  </PropertyGroup>
</Project>
`,
);
console.log(`wrote ${blocks} C# blocks to ${cs}`);
