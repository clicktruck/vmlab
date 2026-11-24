#!/bin/sh
# Checks the three tools vmlab needs on the host: Docker, just and git. Changes nothing.
# Complete commands to install a missing one are printed, never run.
set -eu
missing=0
check() {
  if command -v "$1" >/dev/null 2>&1; then
    printf '  ok       %s\n' "$1"
  else
    printf '  MISSING  %s: %s\n' "$1" "$2"
    missing=1
  fi
}
echo "vmlab needs these on this computer:"
check docker "install Docker (OrbStack or Docker Desktop on a Mac; Docker Desktop on Windows), then run: docker version"
check just "install just (https://just.systems), for example: brew install just"
check git "install git (https://git-scm.com/downloads)"
if [ "$missing" -ne 0 ]; then
  echo "Install the missing tools and run: just doctor"
  exit 1
fi
echo "All three are here."
