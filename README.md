# Image Converter: WebP only

Obsidian plugin that automatically converts pasted images to WebP.

Conversion uses Electron's built-in Chromium Canvas API (`OffscreenCanvas.convertToBlob`) — no native dependencies, no wasm, no external tools. The entire plugin is ~1.7 KB.

## How it works

1. Intercepts paste events containing images (PNG, JPEG, BMP, etc.)
2. Converts to WebP via `createImageBitmap` → `OffscreenCanvas` → `convertToBlob({ type: "image/webp" })`
3. Saves to your configured attachment folder and inserts a `![[wikilink]]`
- I recommend having all attachments in a single flat folder. `Settings -> Files and links -> Default location for new attachments & Attachment folder path`
