# Maintaining Clipboard Compare

This document is for maintainers. The README is the short user guide.

## Verify a release

```sh
npm ci
npm run check
```

The browser suite requires Google Chrome. For native integration testing, install the build into the disposable `clipboard-compare-test-vault` and run `node tests/obsidian.mjs` with the official Obsidian CLI enabled. Never point this suite at a personal vault.

The minimum supported version is **Obsidian 1.14.5**, the desktop version used for native testing. Test before lowering it. Keep `manifest.json`, `package.json`, and `versions.json` consistent.

## Publish on GitHub

1. Build from the release commit and run all checks.
2. Use a tag that exactly matches `manifest.json` (for example `0.1.0`, without a `v` prefix).
3. Attach `main.js`, `manifest.json`, and `styles.css` from `dist/clipboard-compare` as **individual release assets**.
4. Also provide `clipboard-compare.zip` containing the `clipboard-compare` folder for manual installation.
5. Verify the release assets can be downloaded without authentication and that the uploaded manifest matches the source.

The repository must be publicly accessible. No secrets, test vaults, or dependencies belong in Git.

## Submit to the community directory

Follow the [official submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin): sign in to the Obsidian Community directory, connect the GitHub account, and submit this repository as a new plugin. Submission includes agreeing to the developer policies and a maintenance commitment; the owner must complete that step. Preparation of a GitHub release does not imply Obsidian approval.

## Implementation notes

- All text comparison happens locally. There are no remote services, telemetry, payments, or outside-vault file access.
- Clipboard text is saved in the local workspace layout to restore comparison tabs. It can therefore be included in workspace backups or sync.
- Monaco may leave an EOF-only final-newline difference unchanged when using a restore arrow; the right editor allows manual correction.
- Pop-out windows are not yet verified. Use the comparison in the main Obsidian window.
- Monaco's license and third-party notices are included in the bundled JavaScript.
