# syntax=docker/dockerfile:1
# The vmlab command line. Node runs the .ts sources directly, so there is no build step.
# It also holds the Azure CLI, which the Azure provider runs with an argument list and no shell.
FROM node:26-slim

# Dependencies come from pnpm-lock.yaml and live one level above the source, in /workspace/node_modules,
# so mounting ./cli over /workspace/cli for development does not hide them. Node finds them by walking up.
WORKDIR /workspace
COPY package.json pnpm-lock.yaml ./

# pnpm at the version package.json names ("packageManager"), so the version is written in one place.
RUN npm install --global "$(node -p "require('./package.json').packageManager")" && npm cache clean --force
RUN pnpm install --frozen-lockfile
ENV PATH=/workspace/node_modules/.bin:$PATH

# The Azure CLI is a Python app. It gets its own virtual environment at the version named in azure-cli.txt.
# Sign-in tokens are not in the image: they live in the Docker volume mounted at /root/.azure (compose.yaml).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY azure-cli.txt /tmp/azure-cli.txt
RUN python3 -m venv /opt/az \
    && /opt/az/bin/pip install --no-cache-dir -r /tmp/azure-cli.txt \
    && ln -s /opt/az/bin/az /usr/local/bin/az
ENV AZURE_CONFIG_DIR=/root/.azure AZURE_CORE_COLLECT_TELEMETRY=false AZURE_CORE_NO_COLOR=true AZURE_CORE_ONLY_SHOW_ERRORS=true

COPY . /workspace/cli
WORKDIR /workspace/cli

CMD ["node", "src/main.ts", "--help"]
