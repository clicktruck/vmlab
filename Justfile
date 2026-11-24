# vmlab: the code runs in Docker. The host needs Docker, just and git (docs/05-install.md).
# Run `just` to list the recipes.

# On Windows, recipes run under the sh that ships with Git for Windows.
[unix]
set shell := ["bash", "-euo", "pipefail", "-c"]
[windows]
set shell := ["sh", "-eu", "-c"]

set positional-arguments

# Git Bash on Windows rewrites arguments that look like Unix paths before Docker sees them. These switch that off.
export MSYS_NO_PATHCONV := "1"
export MSYS2_ARG_CONV_EXCL := "*"

compose := "docker compose"
in_cli := compose + " run --rm --no-deps --workdir /workspace/cli cli"

# List the recipes
default:
    @just --list --unsorted

# Check what vmlab needs on this computer and say how to install what is missing
[group('setup')]
doctor:
    @sh scripts/prereqs.sh

# Build the Docker image (run again after changing dependencies)
[group('setup')]
images:
    {{ compose }} build

# Run a vmlab command, for example: just vmlab config check
[group('run')]
vmlab *args:
    {{ compose }} run --rm cli node /workspace/cli/src/main.ts "$@"

# Sign in to Azure. Opens no browser: it prints a code to type at the address it shows. Example: just login --tenant YOUR-TENANT.onmicrosoft.com
[group('run')]
login *args:
    {{ compose }} run --rm cli az login --use-device-code "$@"

# Copy this computer's Azure sign-in into vmlab's token volume (for when `just login` is blocked). Asks first.
[group('run')]
adopt-login:
    @sh scripts/adopt-login.sh

# Make a dedicated sign-in for vmlab (a service principal with Contributor on one subscription) and use it. Asks first. Optional name: just sp-create my-name
[group('run')]
sp-create *name:
    @sh scripts/sp-create.sh "$@"

# Sign in as a service principal you already have: asks for tenant, application id and a hidden secret
[group('run')]
sp-login:
    @sh scripts/sp-login.sh

# Show who vmlab is signed in to Azure as, and which subscription it would use. Reads only.
[group('run')]
whoami:
    {{ compose }} run --rm cli az account show --query "{subscription:name, state:state, tenant:tenantDisplayName, user:user.name}" -o table

# Forget the Azure sign-in: deletes the token volume
[group('run')]
logout:
    {{ compose }} run --rm cli az logout
    {{ compose }} down --volumes

# Write the JSON Schemas in schema/ from the schemas in the code
[group('dev')]
schema:
    {{ in_cli }} node src/schema-write.ts

# Type-check, lint and test everything
[group('dev')]
check: lint typecheck test

# Lint and check formatting
[group('dev')]
lint:
    {{ in_cli }} biome check .
    for f in scripts/*.sh; do sh -n "$f"; done

# Fix formatting
[group('dev')]
fmt:
    {{ in_cli }} biome check --write .

# Type-check the TypeScript
[group('dev')]
typecheck:
    {{ in_cli }} tsc --noEmit

# Run the tests. They never need a cloud.
[group('dev')]
test:
    {{ compose }} run --rm --workdir /workspace/cli cli node --test

# Check that every PowerShell script sent to a Windows machine parses, and that the C# inside them compiles (throwaway containers; pulls two images the first time). A smoke check: it runs nothing
[group('check')]
lint-ps:
    {{ compose }} run --rm --no-deps cli node /workspace/cli/src/dump-scripts.ts
    docker run --rm -v "$PWD:/w:ro" mcr.microsoft.com/powershell:latest pwsh -NoProfile -File /w/scripts/parse-powershell.ps1
    docker run --rm -v "$PWD/scratch/cs:/src:ro" mcr.microsoft.com/dotnet/sdk:8.0 sh -c 'cp -r /src /b && cd /b && dotnet build -nologo -v q'

# Tests against a real cloud: they cost money and are never run by CI (Planned: see ROADMAP.md)
[group('dev')]
live:
    @echo "just live is Planned (ROADMAP.md): live tests cost money. Nothing was run."; exit 1
