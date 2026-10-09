#!/bin/sh
# Generates the offline sources flatpak-builder needs (cargo-sources.json, node-sources.json)
# from the lockfiles. Needs uv, curl and git. See packaging/README.md.
set -eu
cd "$(dirname "$0")"
TOOLS=74697c75b630d7330e77250fc13cb5ea688d9479 # flatpak/flatpak-builder-tools
uvx --from "git+https://github.com/flatpak/flatpak-builder-tools.git@$TOOLS#subdirectory=node" \
  flatpak-node-generator --no-requests-cache -o node-sources.json npm ../../package-lock.json
gen=$(mktemp)
curl -fsSL "https://raw.githubusercontent.com/flatpak/flatpak-builder-tools/$TOOLS/cargo/flatpak-cargo-generator.py" -o "$gen"
uv run --no-project --with 'aiohttp>=3.9.5,<4' --with 'PyYAML>=6.0.2,<7' --with 'tomlkit>=0.13.3,<1' \
  python "$gen" -o cargo-sources.json ../../src-tauri/Cargo.lock
rm -f "$gen"
