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

interface PreparedLoupeImport {
  clipboardText: string;
  params: LoupeImportParams;
}

const DEFAULTS: Settings = { quality: 85 };

async function toWebP(source: Blob, quality: number): Promise<ArrayBuffer> {
  const bitmap: ImageBitmap = await createImageBitmap(source);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx: OffscreenCanvasRenderingContext2D | null = canvas.getContext("2d");
    if (ctx === null) {
      throw new Error("2d canvas context unavailable");
    }
    ctx.drawImage(bitmap, 0, 0);
    const blob: Blob = await canvas.convertToBlob({
      quality: quality / 100,
      type: "image/webp",
    });
    return await blob.arrayBuffer();
  } finally {
    bitmap.close();
  }
}

async function isUsableWebP(source: Blob): Promise<boolean> {
  const bitmap: ImageBitmap = await createImageBitmap(source);
  try {
    return bitmap.width > 0 && bitmap.height > 0;
  } finally {
    bitmap.close();
  }
}

function isWebPContentType(contentType: string): boolean {
  return contentType.split(";", 1)[0]?.trim() === "image/webp";
}

function extractPastedImage(evt: ClipboardEvent): File | null {
  const file: File | undefined = evt.clipboardData?.files[0];
  if (file === undefined || !file.type.startsWith("image/") || file.type === "image/webp") {
    return null;
  }
  return file;
}

const WEBP_EXTENSION = "webp";

export default class WebPPastePlugin extends Plugin {
  override settings: Settings = DEFAULTS;
  private loupeImportQueue: Promise<void> = Promise.resolve();

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
      this.enqueueLoupeImport(params);
    });
  }

  private async handlePaste(image: File, editor: Editor, activeFile: TFile): Promise<void> {
    const data: ArrayBuffer = await toWebP(image, this.settings.quality);
    const baseName = `${activeFile.basename} ${loupeImageTimestamp()}`;
    const path: string = await this.app.fileManager.getAvailablePathForAttachment(
      `${baseName}.${WEBP_EXTENSION}`,
      activeFile.path,
    );
    const created: TFile = await this.app.vault.createBinary(path, data);
    editor.replaceSelection(`![[${created.name}]]`);
  }

  private failLoupeImport(message: string, error?: unknown): void {
    if (error !== undefined) {
      console.error(message, error);
    }
    new Notice(message);
  }

  private enqueueLoupeImport(params: ObsidianProtocolData): void {
    void this.prepareLoupeImport(params)
      .then((prepared) => {
        if (prepared === null) {
          return;
        }
        this.loupeImportQueue = this.loupeImportQueue
          .then(() => this.createLoupeNoteAndLocalize(prepared))
          .catch((error) => {
            this.failLoupeImport("Loupe import failed unexpectedly.", error);
          });
      })
      .catch((error) => {
        this.failLoupeImport("Loupe import could not be prepared.", error);
      });
  }

  // Companion handler for the Loupe reader extension's "Open in Obsidian"
  // button. The article Markdown travels via the clipboard; the
  // `obsidian://loupe-import` URI carries only the note name, the source page
  // URL (for resolving relative image destinations), and a SHA-256 of the
  // exact clipboard text so stale or mismatched clipboard contents are refused.
  private async prepareLoupeImport(
    params: ObsidianProtocolData,
  ): Promise<PreparedLoupeImport | null> {
    let loupeParams: LoupeImportParams;
    try {
      loupeParams = parseLoupeImportParams(params);
    } catch (error) {
      this.failLoupeImport("Loupe import received invalid parameters.", error);
      return null;
    }

    let clipboardText: string;
    try {
      clipboardText = await navigator.clipboard.readText();
    } catch (error) {
      this.failLoupeImport(
        "Loupe import could not read the clipboard. Copy the article again and retry.",
        error,
      );
      return null;
    }
    if (clipboardText === "") {
      this.failLoupeImport(
        "Loupe import found an empty clipboard. Copy the article again and retry.",
      );
      return null;
    }
    let clipboardMatches: boolean;
    try {
      clipboardMatches = await verifyLoupeClipboard(clipboardText, loupeParams.sha256);
    } catch (error) {
      this.failLoupeImport(
        "Loupe import could not verify the clipboard. Copy the article again and retry.",
        error,
      );
      return null;
    }
    if (!clipboardMatches) {
      this.failLoupeImport(
        "Loupe import clipboard contents changed. Copy the article again and retry.",
      );
      return null;
    }

    return { clipboardText, params: loupeParams };
  }

  private async createLoupeNoteAndLocalize(prepared: PreparedLoupeImport): Promise<void> {
    const { clipboardText, params } = prepared,
      activeFile = this.app.workspace.getActiveFile();
    const parent = this.app.fileManager.getNewFileParent(
      activeFile?.path ?? "",
      `${params.file}.md`,
    );
    const notePath = firstAvailablePath(
      buildLoupeNotePath(parent.path, params.file),
      (path) => this.app.vault.getAbstractFileByPath(path) !== null,
    );
    let note: TFile;
    try {
      note = await this.app.vault.create(notePath, clipboardText);
    } catch (error) {
      this.failLoupeImport("Loupe import could not create the note.", error);
      return;
    }
    try {
      await this.app.workspace.getLeaf(false).openFile(note);
    } catch (error) {
      this.failLoupeImport("Loupe import created the note but could not open it.", error);
    }
    await this.localizeLoupeImages(note, clipboardText, params.source);
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

    if (!(await this.ensureLoupeImageFolder())) {
      return;
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

    const progressNotice = new Notice(
      `Loupe: importing images (0/${targets.length})…`,
      0,
    );
    let downloads: Array<{
      resolvedUrl: string;
      embed: string;
      file: TFile;
    } | null>;
    try {
      downloads = await mapWithConcurrency(
        targets,
        4,
        async (target) => {
          try {
            const data = await this.downloadLoupeImage(target.resolvedUrl);
            if (data === null) {
              return null;
            }
            const created = await this.app.vault.createBinary(target.path, data);
            return { resolvedUrl: target.resolvedUrl, embed: `![[${created.path}]]`, file: created };
          } catch (error) {
            console.warn(`Loupe import could not localize ${target.resolvedUrl}.`, error);
            return null;
          }
        },
        (completed) => {
          progressNotice.setMessage(`Loupe: importing images (${completed}/${targets.length})…`);
        }
      );
    } finally {
      progressNotice.hide();
    }

    const createdFiles: TFile[] = [];
    const urlToEmbed = new Map<string, string>();
    for (const download of downloads) {
      if (download !== null) {
        createdFiles.push(download.file);
        urlToEmbed.set(download.resolvedUrl, download.embed);
      }
    }

    if (urlToEmbed.size > 0) {
      try {
        await this.app.vault.process(note, (current) =>
          applyLoupeImageLocalizations(current, sourceUrl, urlToEmbed),
        );
      } catch (error) {
        await this.cleanupLoupeImages(createdFiles);
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

  private async ensureLoupeImageFolder(): Promise<boolean> {
    if (this.app.vault.getFolderByPath(LOUPE_IMAGE_FOLDER) !== null) {
      return true;
    }
    try {
      await this.app.vault.createFolder(LOUPE_IMAGE_FOLDER);
      return true;
    } catch (error) {
      // Another import can create the folder after our check. A file at this
      // path is still an error because no asset can be written beneath it.
      if (this.app.vault.getFolderByPath(LOUPE_IMAGE_FOLDER) !== null) {
        return true;
      }
      this.failLoupeImport("Loupe import could not create the z-images folder.", error);
      return false;
    }
  }

  private async cleanupLoupeImages(files: readonly TFile[]): Promise<void> {
    for (const file of files) {
      if (this.app.vault.getAbstractFileByPath(file.path) !== file) {
        continue;
      }
      try {
        await this.app.vault.delete(file);
      } catch (error) {
        console.warn(`Loupe import could not remove ${file.path} after a failed rewrite.`, error);
      }
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
    const source = new Blob([buffer], { type: contentType });
    if (isWebPContentType(contentType) && isWebPBytes(buffer)) {
      try {
        if (await isUsableWebP(source)) {
          return buffer;
        }
      } catch (error) {
        console.warn(`Loupe import received an invalid WebP response from ${resolvedUrl}.`, error);
      }
    }
    try {
      return await toWebP(source, this.settings.quality);
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
