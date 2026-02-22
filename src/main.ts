import { type App, type Editor, type MarkdownView, type TFile, Plugin, PluginSettingTab, Setting } from "obsidian";

interface Settings {
	quality: number;
}

const DEFAULTS: Settings = { quality: 85 };

async function toWebP(file: File, quality: number): Promise<ArrayBuffer> {
	const bitmap = await createImageBitmap(file);
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
	bitmap.close();
	const blob = await canvas.convertToBlob({ type: "image/webp", quality: quality / 100 });
	return blob.arrayBuffer();
}

function timestamp(): string {
	const d = new Date();
	return [
		d.getFullYear(),
		d.getMonth() + 1,
		d.getDate(),
		d.getHours(),
		d.getMinutes(),
		d.getSeconds(),
	].map((n, i) => (i === 0 ? String(n) : String(n).padStart(2, "0"))).join("");
}

function extractPastedImage(evt: ClipboardEvent): File | null {
	const file = evt.clipboardData?.files[0];
	if (!file?.type.startsWith("image/") || file.type === "image/webp") return null;
	return file;
}

async function attachmentPath(vault: any, baseName: string, ext: string, activeFile: TFile): Promise<string> {
	if (vault.getAvailablePathForAttachments) {
		return vault.getAvailablePathForAttachments(baseName, ext, activeFile);
	}
	const dir = activeFile.parent?.path ?? "";
	return vault.getAvailablePath(dir ? `${dir}/${baseName}` : baseName, ext);
}

export default class WebPPastePlugin extends Plugin {
	settings: Settings = DEFAULTS;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new WebPPasteSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on("editor-paste", (evt: ClipboardEvent, editor: Editor, view: MarkdownView) => {
				const image = extractPastedImage(evt);
				if (!image || !view.file) return;
				evt.preventDefault();
				this.handlePaste(image, editor, view.file);
			}),
		);
	}

	private async handlePaste(image: File, editor: Editor, activeFile: TFile) {
		const data = await toWebP(image, this.settings.quality);
		const baseName = `${activeFile.basename} ${timestamp()}`;
		const path = await attachmentPath(this.app.vault, baseName, "webp", activeFile);
		const created = await this.app.vault.createBinary(path, data);
		editor.replaceSelection(`![[${created.name}]]`);
	}

	async loadSettings() {
		this.settings = { ...DEFAULTS, ...(await this.loadData()) };
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class WebPPasteSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: WebPPastePlugin) {
		super(app, plugin);
	}

	display() {
		this.containerEl.empty();
		new Setting(this.containerEl)
			.setName("Image quality")
			.setDesc("WebP compression quality (1–100). Lower = smaller files.")
			.addSlider((s) =>
				s.setLimits(1, 100, 1)
					.setValue(this.plugin.settings.quality)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.quality = v;
						await this.plugin.saveSettings();
					}),
			);
	}
}
