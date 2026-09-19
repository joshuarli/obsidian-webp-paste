import {
  type App,
  type Editor,
  type MarkdownFileInfo,
  type MarkdownView,
  Notice,
  type ObsidianProtocolData,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
  type TFile,
  type Vault,
} from "obsidian";
import {
  applyLoupeImageLocalizations,
  buildLoupeImagePath,
  buildLoupeNotePath,
  collectLoupeRemoteImages,
  firstAvailablePath,
  isWebPBytes,
  LOUPE_IMAGE_FOLDER,
  loupeImageTimestamp,
  mapWithConcurrency,
  parseLoupeImportParams,
  readResponseContentType,
  type LoupeImportParams,
  verifyLoupeClipboard,
} from "./loupe-import.ts";

interface Settings {
  quality: number;
}

const DEFAULTS: Settings = { quality: 85 };

interface AttachmentVault {
  getAvailablePath: (path: string, ext: string) => Promise<string> | string;
  getAvailablePathForAttachments?: (
    baseName: string,
    ext: string,
    activeFile: TFile,
  ) => Promise<string> | string;
}

function asAttachmentVault(vault: Vault): AttachmentVault {
  return vault as unknown as AttachmentVault;
}

async function toWebP(source: Blob, quality: number): Promise<ArrayBuffer> {
  const bitmap: ImageBitmap = await createImageBitmap(source);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx: OffscreenCanvasRenderingContext2D | null = canvas.getContext("2d");
  if (ctx === null) {
    bitmap.close();
    throw new Error("2d canvas context unavailable");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob: Blob = await canvas.convertToBlob({
    quality: quality / 100,
    type: "image/webp",
  });
  return await blob.arrayBuffer();
}

function extractPastedImage(evt: ClipboardEvent): File | null {
  const file: File | undefined = evt.clipboardData?.files[0];
  if (file === undefined || !file.type.startsWith("image/") || file.type === "image/webp") {
    return null;
  }
  return file;
}

const WEBP_EXTENSION = "webp";

async function attachmentPath(vault: Vault, baseName: string, activeFile: TFile): Promise<string> {
  const compat: AttachmentVault = asAttachmentVault(vault);
  const byAttachments: AttachmentVault["getAvailablePathForAttachments"] =
    compat.getAvailablePathForAttachments;
  if (byAttachments !== undefined) {
    return await byAttachments(baseName, WEBP_EXTENSION, activeFile);
  }
  const dir: string = activeFile.parent?.path ?? "";
  return await compat.getAvailablePath(
    dir === "" ? baseName : `${dir}/${baseName}`,
    WEBP_EXTENSION,
  );
}

export default class WebPPastePlugin extends Plugin {
  override settings: Settings = DEFAULTS;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new WebPPasteSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on(
        "editor-paste",
        (evt: ClipboardEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
          const image: File | null = extractPastedImage(evt);
          const target: TFile | null = info.file;
          if (image === null || target === null) {
            return;
          }
          evt.preventDefault();
          void this.handlePaste(image, editor, target);
        },
      ),
    );
    this.registerObsidianProtocolHandler("loupe-import", (params: ObsidianProtocolData) => {
      void this.handleLoupeImport(params);
    });
  }

  private async handlePaste(image: File, editor: Editor, activeFile: TFile): Promise<void> {
    const data: ArrayBuffer = await toWebP(image, this.settings.quality);
    const baseName = `${activeFile.basename} ${loupeImageTimestamp()}`;
    const path: string = await attachmentPath(this.app.vault, baseName, activeFile);
    const created: TFile = await this.app.vault.createBinary(path, data);
    editor.replaceSelection(`![[${created.name}]]`);
  }

  private failLoupeImport(message: string, error?: unknown): void {
    if (error !== undefined) {
      console.error(message, error);
    }
    new Notice(message);
  }

  // Companion handler for the Loupe reader extension's "Open in Obsidian"
  // button. The article Markdown travels via the clipboard; the
  // `obsidian://loupe-import` URI carries only the note name, the source page
  // URL (for resolving relative image destinations), and a SHA-256 of the
  // exact clipboard text so stale clipboard contents are refused.
  private async handleLoupeImport(params: ObsidianProtocolData): Promise<void> {
    let loupeParams: LoupeImportParams;
    try {
      loupeParams = parseLoupeImportParams(params);
    } catch (error) {
      this.failLoupeImport("Loupe import received invalid parameters.", error);
      return;
    }

    let clipboardText: string;
    try {
      clipboardText = await navigator.clipboard.readText();
    } catch (error) {
      this.failLoupeImport(
        "Loupe import could not read the clipboard. Copy the article again and retry.",
        error,
      );
      return;
    }
    if (clipboardText === "") {
      this.failLoupeImport(
        "Loupe import found an empty clipboard. Copy the article again and retry.",
      );
      return;
    }
    if (!(await verifyLoupeClipboard(clipboardText, loupeParams.sha256))) {
      this.failLoupeImport(
        "Loupe import clipboard contents changed. Copy the article again and retry.",
      );
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    const parent = this.app.fileManager.getNewFileParent(
      activeFile?.path ?? "",
      `${loupeParams.file}.md`,
    );
    const notePath = firstAvailablePath(
      buildLoupeNotePath(parent.path, loupeParams.file),
      (path) => this.app.vault.getAbstractFileByPath(path) !== null,
    );
    let note: TFile;
    try {
      note = await this.app.vault.create(notePath, clipboardText);
    } catch (error) {
      this.failLoupeImport("Loupe import could not create the note.", error);
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(note);
    await this.localizeLoupeImages(note, clipboardText, loupeParams.source);
  }

  private async localizeLoupeImages(
    note: TFile,
    markdown: string,
    sourceUrl: string,
  ): Promise<void> {
    const remoteImages = collectLoupeRemoteImages(markdown, sourceUrl);
    if (remoteImages.length === 0) {
      return;
    }

    if (this.app.vault.getAbstractFileByPath(LOUPE_IMAGE_FOLDER) === null) {
      try {
        await this.app.vault.createFolder(LOUPE_IMAGE_FOLDER);
      } catch (error) {
        console.error("Loupe import could not create the image folder.", error);
        return;
      }
    }

    const takenPaths = new Set<string>();
    const pathExists = (path: string): boolean =>
      takenPaths.has(path) || this.app.vault.getAbstractFileByPath(path) !== null;
    const timestamp = loupeImageTimestamp();
    const targets = remoteImages.map((image, index) => {
      const path = firstAvailablePath(
        buildLoupeImagePath(note.basename, timestamp, index + 1),
        pathExists,
      );
      takenPaths.add(path);
      return { resolvedUrl: image.resolvedUrl, path };
    });

    const downloads = await mapWithConcurrency(targets, 4, async (target) => {
      try {
        const data = await this.downloadLoupeImage(target.resolvedUrl);
        if (data === null) {
          return null;
        }
        const created = await this.app.vault.createBinary(target.path, data);
        return { resolvedUrl: target.resolvedUrl, embed: `![[${created.path}]]` };
      } catch (error) {
        console.warn(`Loupe import could not localize ${target.resolvedUrl}.`, error);
        return null;
      }
    });

    const urlToEmbed = new Map<string, string>();
    for (const download of downloads) {
      if (download !== null) {
        urlToEmbed.set(download.resolvedUrl, download.embed);
      }
    }

    if (urlToEmbed.size > 0) {
      try {
        await this.app.vault.process(note, (current) =>
          applyLoupeImageLocalizations(current, sourceUrl, urlToEmbed),
        );
      } catch (error) {
        console.error("Loupe import downloaded images but could not update the note.", error);
        new Notice("Loupe import downloaded images but could not update the note.");
        return;
      }
    }

    if (urlToEmbed.size < remoteImages.length) {
      new Notice(
        `Loupe: localized ${urlToEmbed.size} of ${remoteImages.length} images; ${remoteImages.length - urlToEmbed.size} remain external.`,
      );
    }
  }

  private async downloadLoupeImage(resolvedUrl: string): Promise<ArrayBuffer | null> {
    let status: number;
    let buffer: ArrayBuffer;
    let contentType: string;
    try {
      const response = await requestUrl({ url: resolvedUrl, method: "GET", throw: false });
      status = response.status;
      buffer = response.arrayBuffer;
      contentType = readResponseContentType(response.headers);
    } catch (error) {
      console.warn(`Loupe import could not download ${resolvedUrl}.`, error);
      return null;
    }
    if (status < 200 || status >= 300 || buffer.byteLength === 0) {
      console.warn(`Loupe import received HTTP ${status} for ${resolvedUrl}.`);
      return null;
    }
    if (contentType.includes("image/webp") && isWebPBytes(buffer)) {
      return buffer;
    }
    try {
      return await toWebP(new Blob([buffer]), this.settings.quality);
    } catch (error) {
      console.warn(`Loupe import could not convert ${resolvedUrl} to WebP.`, error);
      return null;
    }
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<Settings> | undefined;
    this.settings = { ...DEFAULTS, ...data };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class WebPPasteSettingTab extends PluginSettingTab {
  private readonly plugin: WebPPastePlugin;

  constructor(app: App, plugin: WebPPastePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl).setName("quality").addSlider((slider) =>
      slider
        .setLimits(1, 100, 1)
        .setValue(this.plugin.settings.quality)
        .setDynamicTooltip()
        .onChange((value: number) => {
          this.plugin.settings.quality = value;
          void this.plugin.saveSettings();
        }),
    );
  }
}
