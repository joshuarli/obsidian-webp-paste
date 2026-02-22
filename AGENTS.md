# obsidian-webp-paste

Obsidian plugin that converts pasted images to WebP. All source code is in `src/main.ts`.

## How it works

1. Registers an `editor-paste` event handler on plugin load.
2. When a paste event contains an image file (png, jpeg, bmp, etc.), it calls `preventDefault()` to stop Obsidian's default paste behavior. Already-webp images are ignored and left to default handling.
3. Converts the image to WebP using the browser-native Canvas API: `createImageBitmap` → `OffscreenCanvas` → `convertToBlob({ type: 'image/webp', quality })`.
4. Saves the resulting ArrayBuffer to the vault via `vault.createBinary()`, using Obsidian's internal `getAvailablePathForAttachments` API to respect the user's configured attachment folder.
5. Inserts a markdown link at the cursor via `editor.replaceSelection()`.

## Settings

One setting: **quality** (1–100, default 85). Exposed as a slider in the settings tab. Persisted via `loadData()`/`saveData()`.

## Building

`bun run build` bundles `src/main.ts` → `main.js`. `just install` builds and copies into the vault.
