# Role Color Everywhere

A small Valenced plugin that brings Discord role colors to more places.

It colors user mentions in messages and usernames in voice channels using the member's highest role color.

## Features

- **Message mentions:** Shows a user's role color when they're mentioned in chat.
- **Voice channels:** Colors the names of people connected to a voice channel.
- **Skip neutral colors:** Optionally ignores white, black, and gray roles so a more noticeable role color can be used.

## Install

Add this repository to Valenced:

```
https://raw.githubusercontent.com/LiFawaz/Role-Colors-Everywhere/gh-pages/index.json
```

Then find **Role Color Everywhere** in the plugin list and install it.

## Settings

Open the plugin's settings to turn message mentions or voice channel names on or off.

You can also toggle **Skip White, Black & Gray Roles**. Turn it off if you want neutral role colors to show too.

## Build

To build it locally:

```sh
bun install
bun --bun run build --plugins-dir plugins role-color-everywhere
python3 scripts/package_plugin.py role-color-everywhere
```

The GitHub Actions workflow builds the plugin and publishes versioned packages to the `gh-pages` branch.
