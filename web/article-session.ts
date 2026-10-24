import {
	createArticle,
	getArticle,
	reviewGrammar,
	updateArticle,
	type ArticleRecord,
	type GradeSample,
	type GrammarWeakness,
	type SentenceRecord,
} from "./api.ts";
import { renderArticle } from "./article.ts";
import type { SentencePanelManager } from "./sentence-panel.ts";
import { parseArticle } from "./text.ts";

/**
 * Keeps the reader and the article library in sync, and owns the per-article study summary.
 *
 * Three rules drive the design. First, the reader is the source of truth while it is open, so
 * leaving the view pushes whatever changed rather than trusting an earlier write. Second, a
 * stored translation only belongs to the sentence text it was made for: pasting an edit into
 * the middle of an article shifts every later sentence, so records are keyed by sentence text
 * rather than index. Third, clicks and grammar weaknesses are per article on purpose — a
 * summary that mixes articles is not a useful review prompt.
 */

export interface SessionOptions {
	doc: Document;
	container: HTMLElement;
	textarea: HTMLTextAreaElement;
	panels: SentencePanelManager;
}

export interface SummaryState {
	clicks: Record<string, number>;
	grammar: GrammarWeakness[];
	grammarPending: boolean;
}

export class ArticleSession {
	private readonly doc: Document;
	private readonly container: HTMLElement;
	private readonly textarea: HTMLTextAreaElement;
	private readonly panels: SentencePanelManager;
	private articleId: string | undefined;
	private title = "";
	private snapshot = "";
	private snapshotTitle = "";
	private clicks = new Map<string, number>();
	private grammar: GrammarWeakness[] = [];
	private grammarPending = false;
	private grammarChecked = false;
	/** The click map as of the last successful write, used to avoid pointless saves. */
	private lastFlushedClicks: Record<string, number> = {};
	constructor(options: SessionOptions) {
		this.doc = options.doc;
		this.container = options.container;
		this.textarea = options.textarea;
		this.panels = options.panels;
	}

	currentId(): string | undefined {
		return this.articleId;
	}

	currentTitle(): string {
		return this.title;
	}

	currentText(): string {
		return this.textarea.value;
	}

	/** Forgets which article is open. Called before loading a different one. */
	reset(): void {
		this.articleId = undefined;
		this.title = "";
		this.snapshot = "";
		this.snapshotTitle = "";
		this.clicks = new Map();
		this.grammar = [];
		this.grammarPending = false;
		this.grammarChecked = false;
		this.panels.reset();
	}

	/** Records one click on a word, scoped to the open article. */
	recordClick(word: string): void {
		const key = word.trim().toLowerCase();
		if (key.length === 0) return;
		this.clicks.set(key, (this.clicks.get(key) ?? 0) + 1);
	}

	clicksSnapshot(): Record<string, number> {
		return Object.fromEntries(this.clicks);
	}

	summary(): SummaryState {
		return { clicks: this.clicksSnapshot(), grammar: [...this.grammar], grammarPending: this.grammarPending };
	}

	/** Loads an article: fills the textarea, renders it, and restores stored work. */
	async load(id: string): Promise<ArticleRecord> {
		const response = await getArticle(id);
		const article = response.article;
		const display = stripLeadingTitle(article.text, article.title);
		this.articleId = article.id;
		this.title = displayTitle(article.title, article.text);
		this.textarea.value = display;
		this.snapshot = display;
		this.snapshotTitle = article.title;

		this.clicks = new Map(Object.entries(article.clicks ?? {}));
		this.grammar = [...(article.weakGrammar ?? [])];
		this.grammarChecked = this.grammar.length > 0;
		this.grammarPending = false;

		this.panels.reset();
		this.panels.adopt(article.sentences);

		this.render(display);
		return article;
	}

	/**
	 * Replaces the title and body, keeping sentence work whose sentence text is unchanged.
	 * Used by the reader's edit dialog; the caller refreshes the header/summary afterward.
	 */
	async applyEdit(title: string, text: string): Promise<void> {
		const body = text.trim();
		if (body.length === 0) throw new Error("正文不能为空。");
		const records = this.panels.collect();
		this.title = title.trim();
		this.panels.reset();
		this.panels.adopt(records);
		this.textarea.value = body;
		this.grammarChecked = false;
		this.render(body);
		await this.flush();
	}

	/**
	 * Works out the grammar weaknesses for this article, once.
	 *
	 * The stored result is reused on every later visit, because the review is a language-model
	 * call and the answer only changes when the grading changes. A fresh review is triggered
	 * only when new grading appeared since the last one was saved.
	 */
	async ensureGrammar(onChange: () => void): Promise<void> {
		const samples = gradedSamples(this.panels.collect());
		if (samples.length === 0) {
			if (this.grammar.length > 0) {
				this.grammar = [];
				this.grammarChecked = false;
				onChange();
			}
			return;
		}
		if (this.grammarChecked && this.grammar.length > 0) return;

		this.grammarPending = true;
		onChange();
		try {
			this.grammar = await reviewGrammar(samples);
			this.grammarChecked = true;
			// Persist straight away so reopening the article does not pay for the review twice.
			if (this.articleId) {
				await updateArticle(this.articleId, { weakGrammar: this.grammar }).catch(() => {});
			}
		} catch {
			this.grammar = [];
			this.grammarChecked = false;
		} finally {
			this.grammarPending = false;
			onChange();
		}
	}

	/**
	 * Writes the current text, sentence work and click counts back to the library.
	 *
	 * Returns false when nothing needed saving, so the caller can stay quiet instead of
	 * creating an empty article every time the reader is opened.
	 */
	async flush(): Promise<boolean> {
		const text = this.textarea.value;
		if (text.trim().length === 0) return false;
		const title = this.title;
		const sentences = this.panels.collect();
		const clicks = this.clicksSnapshot();
		const unchanged =
			text === this.snapshot &&
			title === this.snapshotTitle &&
			this.panels.isDirty() === false &&
			sameClicks(clicks, this.lastFlushedClicks);
		if (this.articleId && unchanged) return false;

		if (this.articleId) {
			const response = await updateArticle(this.articleId, { title, text, sentences, clicks });
			this.title = response.article.title;
		} else {
			const response = await createArticle(text, title, sentences);
			this.articleId = response.article.id;
			this.title = response.article.title;
		}
		this.snapshot = text;
		this.snapshotTitle = this.title;
		this.lastFlushedClicks = clicks;
		this.panels.markClean();
		return true;
	}

	private render(text: string): void {
		renderArticle(this.container, this.doc, parseArticle(text));
	}
}

/** Only graded attempts are evidence about the learner's grammar. */
function gradedSamples(sentences: SentenceRecord[]): GradeSample[] {
	return sentences
		.filter((record) => record.userTranslation.length > 0 && record.analysis.length > 0)
		.map((record) => ({ sentence: record.text, user: record.userTranslation, analysis: record.analysis }));
}

function sameClicks(next: Record<string, number>, previous: Record<string, number>): boolean {
	const nextKeys = Object.keys(next);
	const previousKeys = Object.keys(previous);
	if (nextKeys.length !== previousKeys.length) return false;
	return nextKeys.every((key) => next[key] === previous[key]);
}

/**
 * Older articles often include the title as the first line of the body. The reader shows the
 * title in its own paper header, so that line is removed from the displayed text; the stored
 * text is rewritten the next time the article is saved.
 */
function stripLeadingTitle(text: string, title: string): string {
	const lines = text.split(/\r?\n/);
	const index = lines.findIndex((line) => line.trim().length > 0);
	if (index === -1) return text;
	if (lines[index].trim() !== title.trim()) return text;
	lines.splice(index, 1);
	return lines.join("\n").trim();
}

/**
 * Legacy titles were the first 60 characters of the first line, which can end mid-word.
 * Display a word-bounded ellipsis version; the edit dialog can still replace it entirely.
 */
function displayTitle(title: string, text: string): string {
	const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
	if (title.length < 60 || !firstLine.startsWith(title)) return title;
	const cut = firstLine.slice(0, 59);
	const space = cut.lastIndexOf(" ");
	return `${(space > 20 ? cut.slice(0, space) : cut).trim()}…`;
}