# Role Color Everywhere

Valenced plugin that colors Discord message mentions and voice channel participant names with the member's top role color.

## Install

Add this repository URL in Valenced:

```
https://raw.githubusercontent.com/LiFawaz/Role-Colors-Everywhere/gh-pages/index.json
```

## Build locally

```sh
bun install
bun --bun run build --plugins-dir plugins role-color-everywhere
python3 scripts/package_plugin.py role-color-everywhere
```

The GitHub Actions publish workflow creates versioned ZIPs in the `gh-pages/pool/` directory and regenerates the repository `index.json`.
