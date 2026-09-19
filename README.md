# Image Converter: WebP only

Obsidian plugin that automatically converts pasted images to WebP.

Conversion uses Electron's built-in Chromium Canvas API (`OffscreenCanvas.convertToBlob`) — no native dependencies, no wasm, no external tools. The entire plugin is ~1.7 KB.

## How it works

1. Intercepts paste events containing images (PNG, JPEG, BMP, etc.)
2. Converts to WebP via `createImageBitmap` → `OffscreenCanvas` → `convertToBlob({ type: "image/webp" })`
3. Saves to your configured attachment folder and inserts a `![[wikilink]]`

- I recommend having all attachments in a single flat folder. `Settings -> Files and links -> Default location for new attachments & Attachment folder path`

## Loupe reader imports

When [Loupe](https://github.com/joshuarli/extension-loupe) opens an article in
Obsidian, this plugin verifies Loupe's SHA-256-protected clipboard import,
creates the note, and localizes successfully downloaded remote images as WebP
files in the vault-relative `z-images/` folder. Relative image URLs and
duplicate URLs are handled; individual failures remain as their original
remote Markdown images. An updating Notice reports image-localization progress
while the import is running. Requests use browser-like headers, retry transient
failures with exponential backoff, and run concurrently for every unique image
URL.
