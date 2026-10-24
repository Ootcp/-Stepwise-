/**
 * Promise-based confirmation dialog.
 *
 * The browser's native `confirm()` would satisfy "ask twice" but looks nothing like the
 * rest of the page, and it cannot be styled or tested. This builds the same overlay the
 * popup layer uses, so 清空 reads as part of the app rather than a system alert.
 */
export interface ConfirmOptions {
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
}

export function confirmDialog(doc: Document, options: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => {
		const overlay = doc.createElement("div");
		overlay.className = "dialog-layer";

		const box = doc.createElement("div");
		box.className = "dialog";
		box.setAttribute("role", "alertdialog");
		box.setAttribute("aria-modal", "true");

		const title = doc.createElement("strong");
		title.className = "dialog__title";
		title.textContent = options.title;

		const message = doc.createElement("p");
		message.className = "dialog__message";
		message.textContent = options.message;

		const actions = doc.createElement("div");
		actions.className = "dialog__actions";

		const cancel = doc.createElement("button");
		cancel.type = "button";
		cancel.className = "button dialog__button dialog__button--ghost";
		cancel.textContent = options.cancelLabel ?? "取消";

		const confirm = doc.createElement("button");
		confirm.type = "button";
		confirm.className = "button dialog__button";
		confirm.textContent = options.confirmLabel ?? "确定";

		actions.append(cancel, confirm);
		box.append(title, message, actions);
		overlay.append(box);
		doc.body.append(overlay);

		let settled = false;
		const finish = (value: boolean): void => {
			if (settled) return;
			settled = true;
			overlay.remove();
			doc.defaultView?.removeEventListener("keydown", onKey);
			resolve(value);
		};
		const onKey = (event: { key: string }): void => {
			if (event.key === "Escape") finish(false);
			if (event.key === "Enter") finish(true);
		};

		// A click on the backdrop cancels; a click inside the box must not bubble out.
		overlay.addEventListener("click", () => finish(false));
		box.addEventListener("click", (event: { stopPropagation(): void }) => event.stopPropagation());
		cancel.addEventListener("click", () => finish(false));
		confirm.addEventListener("click", () => finish(true));
		doc.defaultView?.addEventListener("keydown", onKey);
		confirm.focus();
	});
}