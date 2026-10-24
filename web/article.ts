import { tokenize, type Paragraph } from "./text.ts";

/**
 * The speaker icon, drawn rather than typed.
 *
 * A glyph like 🔊 renders differently on every platform and is announced by a screen
 * reader before the button's own label. A drawn icon with an aria-label is one thing, on
 * every machine.
 *
 * The SVG is built through `createElementNS` rather than pasted in as markup. That is the
 * correct way to make an SVG element, and it matters here beyond style: an SVG element is
 * an `Element` and not an `HTMLElement`, so a click on the icon reports a different kind
 * of target than a click on the button. Anything that inspects the target has to know
 * that.
 */
const SVG_NS = "http://www.w3.org/2000/svg";

function speakerIcon(doc: Document): SVGElement {
	const svg = doc.createElementNS(SVG_NS, "svg") as SVGElement;
	svg.setAttribute("class", "icon-svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("width", "15");
	svg.setAttribute("height", "15");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "1.7");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("focusable", "false");

	const body = doc.createElementNS(SVG_NS, "path");
	body.setAttribute("d", "M4 9.5h3.2L12 5.5v13L7.2 14.5H4z");
	svg.append(body);

	const wave = doc.createElementNS(SVG_NS, "path");
	wave.setAttribute("d", "M15.6 9.4a3.6 3.6 0 0 1 0 5.2");
	svg.append(wave);

	const far = doc.createElementNS(SVG_NS, "path");
	far.setAttribute("d", "M18.2 6.8a7.2 7.2 0 0 1 0 10.4");
	svg.append(far);

	return svg;
}

export interface ArticleCallbacks {
	/** A word in the article was clicked. `word` keeps the original casing. */
	onWordClick(word: string, anchor: HTMLElement): void;
	/** A sentence number was clicked. `slot` is the reserved line under that sentence. */
	onSentenceClick(sentence: string, anchor: HTMLElement, slot: HTMLElement): void;
}

function renderSentence(doc: Document, sentence: string, sentenceIndex: number): HTMLElement {
	const wrapper = doc.createElement("div");
	wrapper.className = "sentence";
	wrapper.dataset.index = String(sentenceIndex + 1);
	// The reader needs the whole sentence to speak it, and to work out where each word
	// starts inside it.
	wrapper.dataset.sentence = sentence;

	const marker = doc.createElement("button");
	marker.type = "button";
	marker.className = "sentence__number";
	marker.textContent = String(sentenceIndex + 1).padStart(2, "0");
	marker.dataset.sentence = sentence;
	marker.title = "点击查看整句翻译";

	// The speaker sits right after the number, so the two things that act on a sentence
	// are together instead of the speaker floating at the end of the line.
	const speak = doc.createElement("button");
	speak.type = "button";
	speak.className = "sentence__speak";
	speak.title = "朗读这一句;按住 Shift 点击,或双击,则连续往下读";
	speak.setAttribute("aria-label", `朗读: ${sentence}`);
	speak.append(speakerIcon(doc));

	const gutter = doc.createElement("div");
	gutter.className = "sentence__gutter";
	gutter.append(marker, speak);

	const body = doc.createElement("span");
	body.className = "sentence__text";
	for (const token of tokenize(sentence)) {
		if (token.word === undefined) {
			body.append(doc.createTextNode(token.text));
			continue;
		}
		const wordSpan = doc.createElement("span");
		wordSpan.className = "word";
		wordSpan.dataset.word = token.word;
		wordSpan.textContent = token.text;
		body.append(wordSpan);
	}

	// Reserved empty line so a translation has somewhere to go without shifting the layout
	// further when it appears.
	const slot = doc.createElement("div");
	slot.className = "sentence__slot";

	const bodyWrap = doc.createElement("div");
	bodyWrap.className = "sentence__body";
	bodyWrap.append(body, slot);

	wrapper.append(gutter, bodyWrap);
	return wrapper;
}

/**
 * Renders the parsed article, one paragraph per pasted block, sentences numbered in reading
 * order. Clicks are not bound here: `bindArticleClicks` attaches a single delegated listener
 * to the container, so re-rendering never accumulates listeners.
 *
 * A space text node is inserted between sentences. Sentences are trimmed, so in paragraph
 * layout — where the sentence wrappers are inline — "Hello.Next" would otherwise run together.
 * Between two block boxes the same whitespace is collapsed and invisible, so one render serves
 * both layouts.
 */
export function renderArticle(container: HTMLElement, doc: Document, paragraphs: Paragraph[]): number {
	const fragment = doc.createDocumentFragment();
	let sentenceIndex = 0;
	for (const paragraph of paragraphs) {
		const paragraphElement = doc.createElement("div");
		paragraphElement.className = "paragraph";
		for (const [index, sentence] of paragraph.sentences.entries()) {
			if (index > 0) paragraphElement.append(doc.createTextNode(" "));
			paragraphElement.append(renderSentence(doc, sentence, sentenceIndex));
			sentenceIndex += 1;
		}
		fragment.append(paragraphElement);
	}
	container.replaceChildren(fragment);
	return sentenceIndex;
}

/**
 * One delegated listener for the whole article. Delegation keeps the listener count at one
 * no matter how many words the article has.
 */
export function bindArticleClicks(container: HTMLElement, callbacks: ArticleCallbacks): void {
	container.addEventListener("click", (event) => {
		const target = event.target;
		// Element, not HTMLElement: an SVG element is not an HTMLElement, and the speaker
		// next to the sentence number is drawn as one.
		if (!(target instanceof Element)) return;
		const word = target.closest<HTMLElement>(".word");
		if (word?.dataset.word) {
			event.stopPropagation();
			callbacks.onWordClick(word.dataset.word, word);
			return;
		}
		const number = target.closest<HTMLElement>(".sentence__number");
		const sentence = number?.dataset.sentence;
		if (!number || !sentence) return;
		const slot = number.closest<HTMLElement>(".sentence")?.querySelector<HTMLElement>(".sentence__slot");
		if (slot) callbacks.onSentenceClick(sentence, number, slot);
	});
}