#!/bin/sh
# Signs vmlab in as a service principal you already have (its tenant, application id and secret).
# The secret is typed at a prompt that does not show it, handed to the container through the environment, and never
# printed or put on a command line. The Azure CLI keeps it in its config folder inside the Docker volume.
set -eu
printf 'Tenant (for example your-tenant.onmicrosoft.com): '
read -r VMLAB_SP_TENANT
printf 'Application (client) id: '
read -r VMLAB_SP_APP
printf 'Secret (not shown): '
stty -echo 2>/dev/null || true
read -r VMLAB_SP_SECRET
stty echo 2>/dev/null || true
echo
export VMLAB_SP_TENANT VMLAB_SP_APP VMLAB_SP_SECRET
docker compose run --rm -e VMLAB_SP_TENANT -e VMLAB_SP_APP -e VMLAB_SP_SECRET cli sh -c '
  set -eu
  az login --service-principal -u "$VMLAB_SP_APP" -p "$VMLAB_SP_SECRET" --tenant "$VMLAB_SP_TENANT" -o none
  echo "Signed in. vmlab now sees:"
  az account show --query "{subscription:name, state:state, tenant:tenantDisplayName, kind:user.type}" -o table
'
