#!/bin/sh
# Copies this computer's Azure CLI sign-in into the Docker volume vmlab uses, so `just vmlab ...` can use it.
# For when `just login` (a device code) is blocked by your organisation's sign-in rules, and `az login` on this
# computer works. It copies two files and nothing else, and it never prints their contents.
# The volume then holds a second copy of your sign-in: `just logout` deletes it.
set -eu
src="${AZURE_CONFIG_DIR:-$HOME/.azure}"
for f in msal_token_cache.json azureProfile.json; do
  if [ ! -f "$src/$f" ]; then
    echo "Cannot find $src/$f." >&2
    echo "Sign in on this computer first, in this terminal:  az login --tenant YOUR-TENANT.onmicrosoft.com" >&2
    exit 1
  fi
done
echo "This copies your Azure sign-in from $src into the Docker volume 'azure-token' that vmlab uses."
echo "Two files: msal_token_cache.json (your tokens) and azureProfile.json (your subscriptions)."
echo "A second copy of your sign-in will then exist on this computer, in Docker, until you run: just logout"
printf 'Copy it? [y/N] '
read -r answer
case "$answer" in
  y | Y | yes | YES) ;;
  *)
    echo "No yes, so nothing was copied."
    exit 3
    ;;
esac
docker compose run --rm -v "$src:/host-azure:ro" cli sh -c '
  mkdir -p /root/.azure &&
  cp /host-azure/msal_token_cache.json /host-azure/azureProfile.json /root/.azure/ &&
  chmod 600 /root/.azure/msal_token_cache.json &&
  echo "Copied. vmlab now sees:" &&
  az account show --query "{subscription:name, state:state, tenant:tenantDisplayName, user:user.name}" -o table
'
