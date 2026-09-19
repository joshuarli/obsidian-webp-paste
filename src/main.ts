import {
  type App,
  type Editor,
  type MarkdownFileInfo,
  type MarkdownView,
  Plugin,
  PluginSettingTab,
  Setting,
  type TFile,
  type Vault,
} from "obsidian";

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

async function toWebP(file: File, quality: number): Promise<ArrayBuffer> {
  const bitmap: ImageBitmap = await createImageBitmap(file);
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

function timestamp(): string {
  return new Date().toISOString().replaceAll(/[-:T]/gu, "").slice(0, 14);
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
  }

  private async handlePaste(image: File, editor: Editor, activeFile: TFile): Promise<void> {
    const data: ArrayBuffer = await toWebP(image, this.settings.quality);
    const baseName = `${activeFile.basename} ${timestamp()}`;
    const path: string = await attachmentPath(this.app.vault, baseName, activeFile);
    const created: TFile = await this.app.vault.createBinary(path, data);
    editor.replaceSelection(`![[${created.name}]]`);
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
