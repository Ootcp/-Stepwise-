/**
 * Title + body editor shared by the library's "新建文章" flow and the reader's
 * "编辑文章" action. The rest of the app's dialogs are alert-style; this one needs two
 * fields, inline validation and an async save that can keep the overlay open on failure.
 */
export interface ArticleDialogData {
	title: string;
	text: string;
}

export type ArticleDialogSubmit = (data: ArticleDialogData) => Promise<void> | void;

export class ArticleDialog {
	private readonly doc: Document;
	private readonly layer: HTMLElement;
	private readonly box: HTMLElement;
	private readonly heading: HTMLElement;
	private readonly titleInput: HTMLInputElement;
	private readonly bodyInput: HTMLTextAreaElement;
	private readonly error: HTMLElement;
	private readonly hint: HTMLElement;
	private readonly cancel: HTMLButtonElement;
	private readonly save: HTMLButtonElement;
	private submit: ArticleDialogSubmit | undefined;
	private saveLabel = "保存";
	private busy = false;
	private mounted = false;
	private lastFocus: HTMLElement | null = null;

	constructor(doc: Document) {
		this.doc = doc;

		this.layer = doc.createElement("div");
		this.layer.className = "dialog-layer dialog-layer--article";
		this.layer.hidden = true;

		this.box = doc.createElement("div");
		this.box.className = "dialog dialog--article";
		this.box.setAttribute("role", "dialog");
		this.box.setAttribute("aria-modal", "true");
		this.box.setAttribute("aria-labelledby", "article-dialog-heading");

		this.heading = doc.createElement("strong");
		this.heading.className = "dialog__title";
		this.heading.id = "article-dialog-heading";
		this.heading.textContent = "新建文章";

		const titleField = doc.createElement("label");
		titleField.className = "dialog__field";
		const titleLabel = doc.createElement("span");
		titleLabel.className = "dialog__label";
		titleLabel.textContent = "标题";
		this.titleInput = doc.createElement("input") as HTMLInputElement;
		this.titleInput.type = "text";
		this.titleInput.id = "article-dialog-title";
		this.titleInput.className = "dialog__input";
		this.titleInput.maxLength = 120;
		this.titleInput.placeholder = "留空则用正文首行";
		titleField.append(titleLabel, this.titleInput);

		const bodyField = doc.createElement("label");
		bodyField.className = "dialog__field";
		const bodyLabel = doc.createElement("span");
		bodyLabel.className = "dialog__label";
		bodyLabel.textContent = "正文";
		this.bodyInput = doc.createElement("textarea") as HTMLTextAreaElement;
		this.bodyInput.id = "article-dialog-body";
		this.bodyInput.className = "dialog__textarea";
		this.bodyInput.rows = 12;
		this.bodyInput.placeholder = "粘贴英文文章，空行分段。";
		bodyField.append(bodyLabel, this.bodyInput);

		this.hint = doc.createElement("p");
		this.hint.className = "dialog__hint";
		this.hint.textContent = "正文不能为空；空行分段。标题留空时会使用正文首行。";

		this.error = doc.createElement("p");
		this.error.id = "article-dialog-error";
		this.error.className = "dialog__error";
		this.error.setAttribute("role", "alert");
		this.error.hidden = true;

		const actions = doc.createElement("div");
		actions.className = "dialog__actions";

		this.cancel = doc.createElement("button");
		this.cancel.type = "button";
		this.cancel.className = "button dialog__button dialog__button--ghost";
		this.cancel.id = "article-dialog-cancel";
		this.cancel.textContent = "取消";

		this.save = doc.createElement("button");
		this.save.type = "button";
		this.save.className = "button dialog__button";
		this.save.id = "article-dialog-save";
		this.save.textContent = "保存";

		actions.append(this.cancel, this.save);
		this.box.append(this.heading, titleField, bodyField, this.hint, this.error, actions);
		this.layer.append(this.box);

		this.layer.addEventListener("click", (event) => {
			if (event.target === this.layer) this.close();
		});
		this.box.addEventListener("click", (event) => event.stopPropagation());
		this.cancel.addEventListener("click", () => this.close());
		this.save.addEventListener("click", () => void this.submitNow());
	}

	openCreate(onSubmit: ArticleDialogSubmit): void {
		this.open("新建文章", "创建", "", "", onSubmit, "body");
	}

	openEdit(options: { title: string; text: string; onSubmit: ArticleDialogSubmit }): void {
		this.open("编辑文章", "保存", options.title, options.text, options.onSubmit, "title");
	}

	close(): void {
		if (this.layer.hidden) return;
		this.layer.hidden = true;
		this.busy = false;
		this.error.hidden = true;
		this.save.disabled = false;
		this.save.textContent = this.saveLabel;
		this.doc.defaultView?.removeEventListener("keydown", this.onKey);
		this.layer.remove();
		this.mounted = false;
		const previous = this.lastFocus;
		this.lastFocus = null;
		previous?.focus();
	}

	private open(
		heading: string,
		saveLabel: string,
		title: string,
		text: string,
		onSubmit: ArticleDialogSubmit,
		focus: "title" | "body",
	): void {
		this.heading.textContent = heading;
		this.saveLabel = saveLabel;
		this.save.textContent = saveLabel;
		this.titleInput.value = title;
		this.bodyInput.value = text;
		this.error.hidden = true;
		this.error.textContent = "";
		this.submit = onSubmit;
		this.busy = false;
		this.save.disabled = false;
		this.lastFocus = this.doc.activeElement instanceof HTMLElement ? this.doc.activeElement : null;
		if (!this.mounted) {
			this.doc.body.append(this.layer);
			this.mounted = true;
		}
		this.layer.hidden = false;
		this.doc.defaultView?.addEventListener("keydown", this.onKey);
		if (focus === "title") this.titleInput.focus();
		else this.bodyInput.focus();
	}

	private async submitNow(): Promise<void> {
		if (this.busy || !this.submit) return;
		const title = this.titleInput.value.trim();
		const text = this.bodyInput.value.trim();
		if (text.length === 0) {
			this.error.textContent = "正文不能为空。";
			this.error.hidden = false;
			this.bodyInput.focus();
			return;
		}
		this.error.hidden = true;
		this.busy = true;
		this.save.disabled = true;
		this.save.textContent = "保存中…";
		try {
			await this.submit({ title, text });
			this.busy = false;
			this.close();
		} catch (error) {
			this.busy = false;
			this.save.disabled = false;
			this.save.textContent = this.saveLabel;
			this.error.textContent = describe(error);
			this.error.hidden = false;
		}
	}

	private readonly onKey = (event: KeyboardEvent): void => {
		if (this.layer.hidden) return;
		if (event.key === "Escape") {
			event.preventDefault();
			this.close();
			return;
		}
		if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			void this.submitNow();
		}
	};
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
