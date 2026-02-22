import { Plugin, PluginSettingTab, Setting, Editor, MarkdownView, App, TFile } from "obsidian";

interface WebPPasteSettings {
	quality: number;
}

const DEFAULT_SETTINGS: WebPPasteSettings = {
	quality: 85,
};

export default class WebPPastePlugin extends Plugin {
	settings: WebPPasteSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new WebPPasteSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on("editor-paste", (evt: ClipboardEvent, editor: Editor, view: MarkdownView) => {
				if (!evt.clipboardData) return;
				const files = evt.clipboardData.files;
				if (files.length === 0) return;

				const imageFile = files[0];
				if (!imageFile.type.startsWith("image/")) return;
				if (imageFile.type === "image/webp") return;

				evt.preventDefault();
				this.convertAndSave(imageFile, editor, view);
			})
		);
	}

	async convertAndSave(file: File, editor: Editor, view: MarkdownView) {
		const bitmap = await createImageBitmap(file);
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const ctx = canvas.getContext("2d")!;
		ctx.drawImage(bitmap, 0, 0);
		bitmap.close();

		const webpBlob = await canvas.convertToBlob({
			type: "image/webp",
			quality: this.settings.quality / 100,
		});
		const arrayBuffer = await webpBlob.arrayBuffer();

		const now = new Date();
		const timestamp = now.getFullYear().toString()
			+ String(now.getMonth() + 1).padStart(2, "0")
			+ String(now.getDate()).padStart(2, "0")
			+ String(now.getHours()).padStart(2, "0")
			+ String(now.getMinutes()).padStart(2, "0")
			+ String(now.getSeconds()).padStart(2, "0");
		const baseName = `Pasted image ${timestamp}`;

		const activeFile = view.file;
		if (!activeFile) return;

		const path = await this.getAttachmentPath(baseName, "webp", activeFile);
		const created = await this.app.vault.createBinary(path, arrayBuffer);

		const linkText = this.app.fileManager.generateMarkdownLink(created, activeFile.path);
		editor.replaceSelection(linkText);
	}

	async getAttachmentPath(baseName: string, ext: string, activeFile: TFile): Promise<string> {
		// Use Obsidian's internal helper to respect the user's attachment folder setting
		const folder = (this.app.vault as any).getAvailablePath
			? undefined
			: undefined;

		// getAvailablePathForAttachments is the internal API that respects vault attachment settings
		const internalApp = this.app as any;
		if (internalApp.vault.getAvailablePathForAttachments) {
			return await internalApp.vault.getAvailablePathForAttachments(baseName, ext, activeFile);
		}

		// Fallback: use getAvailablePath in the same folder as the active file
		const dir = activeFile.parent?.path ?? "";
		const prefix = dir ? `${dir}/${baseName}` : baseName;
		return this.app.vault.getAvailablePath(prefix, ext);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class WebPPasteSettingTab extends PluginSettingTab {
	plugin: WebPPastePlugin;

	constructor(app: App, plugin: WebPPastePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Image quality")
			.setDesc("WebP compression quality (1–100). Lower values = smaller files.")
			.addSlider((slider) =>
				slider
					.setLimits(1, 100, 1)
					.setValue(this.plugin.settings.quality)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.quality = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
