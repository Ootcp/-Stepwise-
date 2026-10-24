import {
	EXPORT_TEMPLATES,
	templateInfo,
	type ExportContent,
	type ExportTemplateId,
	type ExportTemplateInfo,
} from "../shared/export-catalog.ts";
import type { ExportWordInput } from "./api.ts";

/**
 * Export sheet for the reader's weak-word list.
 *
 * The catalogue drives the tiles, capacities and the one fixed self-test template; the
 * dialog only chooses presentation. The server builds the .docx and the caller downloads it.
 */

export interface ExportDialogOptions {
	/** Snapshot taken when the sheet opens; later clicks cannot change this export. */
	words: ExportWordInput[];
	title: string;
	onConfirm: (options: {
		template: ExportTemplateId;
		content: ExportContent;
		words: ExportWordInput[];
		title: string;
	}) => Promise<void> | void;
}

export class ExportDialog {
	private readonly doc: Document;
	private readonly layer: HTMLElement;
	private readonly box: HTMLElement;
	private readonly error: HTMLElement;
	private readonly count: HTMLElement;
	private readonly lockNote: HTMLElement;
	private readonly cancel: HTMLButtonElement;
	private readonly confirm: HTMLButtonElement;
	private readonly templateButtons: Array<{ template: ExportTemplateId; button: HTMLButtonElement }> = [];
	private readonly contentButtons: Array<{ content: ExportContent; button: HTMLButtonElement }> = [];

	private template: ExportTemplateId = "color-cards";
	private content: ExportContent = "both";
	private words: ExportWordInput[] = [];
	private title = "";
	private submit: ExportDialogOptions["onConfirm"] | undefined;
	private busy = false;
	private mounted = false;
	private lastFocus: HTMLElement | null = null;

	constructor(doc: Document) {
		this.doc = doc;

		this.layer = doc.createElement("div");
		this.layer.className = "dialog-layer dialog-layer--export";
		this.layer.hidden = true;

		this.box = doc.createElement("div");
		this.box.className = "dialog dialog--export";
		this.box.setAttribute("role", "dialog");
		this.box.setAttribute("aria-modal", "true");
		this.box.setAttribute("aria-labelledby", "export-dialog-heading");

		const heading = doc.createElement("strong");
		heading.className = "dialog__title";
		heading.id = "export-dialog-heading";
		heading.textContent = "导出单词表";

		const note = doc.createElement("p");
		note.className = "dialog__message dialog__message--export";
		note.textContent = "Word 文档 · A4。按这一篇“卡住的词”生成学习卡片，例句留空。";

		const templateField = doc.createElement("div");
		templateField.className = "export-field";
		const templateLabel = doc.createElement("p");
		templateLabel.className = "export-field__label";
		templateLabel.textContent = "模板";
		const templates = doc.createElement("div");
		templates.className = "export-templates";
		templates.setAttribute("role", "radiogroup");
		templates.setAttribute("aria-label", "导出模板");
		for (const info of EXPORT_TEMPLATES) {
			const button = this.createTemplateButton(info);
			templates.append(button);
			this.templateButtons.push({ template: info.id, button });
		}
		templateField.append(templateLabel, templates);

		const contentField = doc.createElement("div");
		contentField.className = "export-field";
		const contentLabel = doc.createElement("p");
		contentLabel.className = "export-field__label";
		contentLabel.textContent = "内容";
		const modes = doc.createElement("div");
		modes.className = "export-modes";
		modes.setAttribute("role", "radiogroup");
		modes.setAttribute("aria-label", "导出内容");
		for (const option of [
			{ content: "word" as const, label: "仅单词" },
			{ content: "meaning" as const, label: "仅中文" },
			{ content: "both" as const, label: "单词 + 中文" },
		]) {
			const button = this.createContentButton(option.content, option.label);
			modes.append(button);
			this.contentButtons.push({ content: option.content, button });
		}
		this.lockNote = doc.createElement("p");
		this.lockNote.className = "export-lock-note";
		this.lockNote.hidden = true;
		contentField.append(contentLabel, modes, this.lockNote);

		this.error = doc.createElement("p");
		this.error.className = "dialog__error dialog__error--export";
		this.error.setAttribute("role", "alert");
		this.error.hidden = true;

		const foot = doc.createElement("div");
		foot.className = "export-foot";
		this.count = doc.createElement("p");
		this.count.className = "export-count";
		const actions = doc.createElement("div");
		actions.className = "dialog__actions";

		this.cancel = doc.createElement("button");
		this.cancel.type = "button";
		this.cancel.className = "button dialog__button dialog__button--ghost";
		this.cancel.textContent = "取消";

		this.confirm = doc.createElement("button");
		this.confirm.type = "button";
		this.confirm.className = "button dialog__button";
		this.confirm.id = "export-confirm";
		this.confirm.textContent = "导出";

		actions.append(this.cancel, this.confirm);
		foot.append(this.count, actions);
		this.box.append(heading, note, templateField, contentField, this.error, foot);
		this.layer.append(this.box);

		this.layer.addEventListener("click", (event) => {
			if (event.target === this.layer && !this.busy) this.close();
		});
		this.box.addEventListener("click", (event) => event.stopPropagation());
		this.cancel.addEventListener("click", () => this.close());
		this.confirm.addEventListener("click", () => void this.submitNow());
	}

	open(options: ExportDialogOptions): void {
		this.words = options.words.slice();
		this.title = options.title;
		this.submit = options.onConfirm;
		this.template = "color-cards";
		this.content = "both";
		this.busy = false;
		this.error.hidden = true;
		this.error.textContent = "";
		this.cancel.disabled = false;
		this.confirm.disabled = this.words.length === 0;
		this.confirm.textContent = "导出";
		this.paint();
		this.lastFocus = this.doc.activeElement instanceof HTMLElement ? this.doc.activeElement : null;
		if (!this.mounted) {
			this.doc.body.append(this.layer);
			this.mounted = true;
		}
		this.layer.hidden = false;
		this.doc.defaultView?.addEventListener("keydown", this.onKey);
		this.templateButtons[0]?.button.focus();
	}

	close(): void {
		if (this.layer.hidden) return;
		this.layer.hidden = true;
		this.busy = false;
		this.error.hidden = true;
		this.confirm.disabled = false;
		this.confirm.textContent = "导出";
		this.cancel.disabled = false;
		this.doc.defaultView?.removeEventListener("keydown", this.onKey);
		this.layer.remove();
		this.mounted = false;
		const previous = this.lastFocus;
		this.lastFocus = null;
		previous?.focus();
	}

	private createTemplateButton(info: ExportTemplateInfo): HTMLButtonElement {
		const button = this.doc.createElement("button") as HTMLButtonElement;
		button.type = "button";
		button.className = "export-template";
		button.dataset.template = info.id;
		button.setAttribute("role", "radio");
		button.setAttribute("aria-checked", "false");

		const preview = this.doc.createElement("span");
		preview.className = `export-template__preview export-template__preview--${info.preview}`;
		if (info.preview === "cards") {
			for (const color of ["orange", "green", "blue", "pink"]) {
				const swatch = this.doc.createElement("span");
				swatch.className = `export-template__swatch export-template__swatch--${color}`;
				preview.append(swatch);
			}
		}

		const label = this.doc.createElement("span");
		label.className = "export-template__name";
		label.textContent = info.label;

		const detail = this.doc.createElement("span");
		detail.className = "export-template__meta";
		detail.textContent = `A4 · ${info.blurb}`;

		button.append(preview, label, detail);
		button.addEventListener("click", () => {
			this.template = info.id;
			this.paint();
		});
		return button;
	}

	private createContentButton(content: ExportContent, label: string): HTMLButtonElement {
		const button = this.doc.createElement("button") as HTMLButtonElement;
		button.type = "button";
		button.className = "export-mode";
		button.dataset.content = content;
		button.setAttribute("role", "radio");
		button.setAttribute("aria-checked", "false");
		button.textContent = label;
		button.addEventListener("click", () => {
			if (button.disabled) return;
			this.content = content;
			this.paint();
		});
		return button;
	}

	private paint(): void {
		for (const item of this.templateButtons) {
			const selected = item.template === this.template;
			item.button.setAttribute("aria-checked", String(selected));
			item.button.classList.toggle("is-selected", selected);
		}
		const info = templateInfo(this.template);
		const locked = info.contentLocked === true;
		for (const item of this.contentButtons) {
			const selected = !locked && item.content === this.content;
			item.button.setAttribute("aria-checked", String(selected));
			item.button.classList.toggle("is-selected", selected);
			item.button.disabled = locked;
		}
		this.lockNote.hidden = !locked;
		this.lockNote.textContent = locked ? (info.contentNote ?? "该模板固定使用设计好的内容版式。") : "";
		const pages = this.words.length === 0 ? 0 : Math.max(1, Math.ceil(this.words.length / info.capacity));
		this.count.textContent = this.words.length === 0 ? "这一篇还没有查过词。" : `共 ${this.words.length} 个词 · 约 ${pages} 页`;
	}

	private async submitNow(): Promise<void> {
		if (this.busy || !this.submit) return;
		if (this.words.length === 0) {
			this.showError("这一篇还没有查过词。");
			return;
		}
		this.busy = true;
		this.error.hidden = true;
		this.confirm.disabled = true;
		this.cancel.disabled = true;
		this.confirm.textContent = "生成中…";
		try {
			await this.submit({ template: this.template, content: this.content, words: this.words.slice(), title: this.title });
			this.busy = false;
			this.close();
		} catch (error) {
			this.busy = false;
			this.confirm.disabled = false;
			this.cancel.disabled = false;
			this.confirm.textContent = "导出";
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private showError(message: string): void {
		this.error.textContent = message;
		this.error.hidden = false;
	}

	private readonly onKey = (event: KeyboardEvent): void => {
		if (this.layer.hidden) return;
		if (event.key === "Escape" && !this.busy) {
			event.preventDefault();
			this.close();
		}
	};
}
