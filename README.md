# Role Colors Everywhere

A Valenced plugin that applies Discord role colors to supported names, mentions, and voice-user displays.

## Add to Valenced

Add this repository URL in Valenced's plugin repository settings:

```
https://raw.githubusercontent.com/LiFawaz/Role-Colors-Everywhere/gh-pages/index.json
```

The repository index and versioned ZIP are published to the `gh-pages` branch by GitHub Actions. The app verifies the ZIP against the SHA-256 recorded in `index.json`.

## Development

```sh
bun install
bun --bun run build --plugins-dir plugins role-color-everywhere
python3 scripts/package_plugin.py role-color-everywhere
python3 scripts/check_zip.py dist/com.lifawaz.role-color-everywhere@1.0.0.zip
```

The plugin is built with the official Valenced plugin CLI and uses the Valenced manifest format. A successful CI build confirms packaging and type/build steps; runtime behavior still needs testing in Valenced on Android.
