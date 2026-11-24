#!/bin/sh
# Makes a dedicated sign-in for vmlab, a service principal (a robot account), and switches vmlab to it.
#   - it holds the Contributor role on ONE subscription (the one you are signed in to) and nothing else;
#   - its secret is made by Azure, kept in the Docker volume vmlab uses, never printed, and valid for one year;
#   - your own sign-in is removed from that volume, so vmlab runs as the robot, not as you.
# You must already be signed in (just login, or just adopt-login) as someone who may register applications in the
# directory AND assign roles on the subscription. `just logout` forgets it; docs/05-install.md says how to delete it.
set -eu
name="${1:-vmlab}"
echo "This will create an app registration and service principal named '$name' in your directory,"
echo "with the Contributor role on the subscription you are signed in to (and nothing else),"
echo "a secret valid for one year, kept in the Docker volume 'azure-token', never printed."
echo "Your own sign-in is then removed from that volume. It is an identity in your tenant, so only you can approve it."
printf 'Create it? [y/N] '
read -r answer
case "$answer" in
  y | Y | yes | YES) ;;
  *)
    echo "No yes, so nothing was created."
    exit 3
    ;;
esac
docker compose run --rm -e VMLAB_SP_NAME="$name" cli sh -c '
  set -eu
  SUB=$(az account show --query id -o tsv)
  SUBNAME=$(az account show --query name -o tsv)
  TENANT=$(az account show --query tenantId -o tsv)
  echo "Creating $VMLAB_SP_NAME with Contributor on subscription $SUBNAME ..."
  CREDS=$(az ad sp create-for-rbac --name "$VMLAB_SP_NAME" --role Contributor --scopes "/subscriptions/$SUB" --years 1 --query "[appId,password]" -o tsv)
  APP=$(printf "%s\n" "$CREDS" | sed -n 1p)
  SECRET=$(printf "%s\n" "$CREDS" | sed -n 2p)
  echo "Created. Its application (client) id is $APP. Find it in Entra: App registrations. The secret was not printed."
  az logout >/dev/null 2>&1 || true
  tries=0
  until az login --service-principal -u "$APP" -p "$SECRET" --tenant "$TENANT" -o none 2>/dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -ge 12 ]; then
      echo "The new sign-in did not work after two minutes. Your own sign-in was removed: run just login or just adopt-login again, and check Entra, App registrations, for $VMLAB_SP_NAME." >&2
      exit 1
    fi
    echo "Waiting for Azure to finish creating it ($tries) ..."
    sleep 10
  done
  az account set --subscription "$SUB"
  echo "Signed in as the service principal. vmlab now sees:"
  az account show --query "{subscription:name, state:state, tenant:tenantDisplayName, kind:user.type}" -o table
'
