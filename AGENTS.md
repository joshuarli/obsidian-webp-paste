# obsidian-webp-paste

Obsidian plugin that converts pasted images to WebP and can localize images
from Loupe reader imports. `src/main.ts` owns the plugin runtime;
`src/loupe-import.ts` contains the pure Loupe parsing, rewrite, hash, and path
helpers with their tests in `test/loupe-import.test.ts`.

## How it works

1. Registers an `editor-paste` event handler on plugin load.
2. When a paste event contains an image file (png, jpeg, bmp, etc.), it calls `preventDefault()` to stop Obsidian's default paste behavior. Already-webp images are ignored and left to default handling.
3. Converts the image to WebP using the browser-native Canvas API: `createImageBitmap` → `OffscreenCanvas` → `convertToBlob({ type: 'image/webp', quality })`.
4. Saves the resulting ArrayBuffer to the vault via `vault.createBinary()`, using the public `FileManager.getAvailablePathForAttachment()` API to respect the user's configured attachment folder.
5. Inserts a markdown link at the cursor via `editor.replaceSelection()`.

## Loupe imports

The plugin registers `obsidian://loupe-import`. Loupe puts its Markdown on the
system clipboard and sends only the note name, source URL, and SHA-256 digest
in the URI. The handler verifies that digest before creating and opening the
note, then scans only standard remote Markdown image embeds.

It resolves relative image URLs against the source page, downloads them with
Obsidian's public `requestUrl()` API, and uses the same Chromium WebP pipeline
as image paste. Successfully localized files are written under the hardcoded,
vault-relative `z-images/` directory and the current note contents are safely
rewritten with `Vault.process()`. Failed image downloads or conversions leave
their original remote embeds intact; the handler emits at most a concise
summary Notice for partial localization.

## Settings

One setting: **quality** (1–100, default 85). Exposed as a slider in the settings tab. Persisted via `loadData()`/`saveData()`.

## Tooling

- Runtime/build: Deno 2 (`deno.json` tasks). TypeScript 7.0.x with strictest `compilerOptions` (mirrored in `deno.json` and `tsconfig.json`).
- Lint: oxlint (`.oxlintrc.json`, all categories denied).
- Format: oxfmt (`.oxfmtrc.json`).
- Bundler: esbuild via `scripts/build.ts` (`src/main.ts` → `main.js`, CJS, `obsidian` external).
- Supply chain: `minimumDependencyAge` is `0` (Deno 2.9+ defaults to a 24h hold, which blocks fast-moving `@types/*` releases).

## Tasks

- `deno task build` — bundle `src/main.ts` → `main.js` (minified).
- `deno task dev` — bundle with inline sourcemap and watch.
- `deno task check` — `deno check` + `tsc --noEmit`.
- `deno task lint` / `lint:fix` — oxlint.
- `deno task fmt` / `fmt:check` — oxfmt write / check.

- `make install` builds and copies into the vault.
- `make package` builds and creates `webp-paste.zip` with the two files required
  by `make install`.
- `make install-remote` downloads the newest non-draft GitHub prerelease archive
  with `gh` and installs it into the configured vault.
- `make release VERSION=x.y.z` bumps `manifest.json`/`package.json`, commits,
  tags, and pushes.

The GitHub Actions workflow is `workflow_dispatch`-only. It runs on the
`macos-26` arm64 runner, builds `webp-paste.zip`, uploads that archive as the
only Actions artifact, and publishes it as a GitHub prerelease asset.
