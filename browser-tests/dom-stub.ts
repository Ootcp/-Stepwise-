/**
 * Tiny DOM stub, just enough to execute `web/main.ts` under Node.
 *
 * The browser wiring is the part of this app no unit test could reach, and that is exactly
 * where a thrown error silently kills every button. Loading the real entry point against
 * this stub turns "all buttons dead" into a failing test.
 */

type Listener = (event: unknown) => void;

/** `camelCase` to `kebab-case`, the conversion dataset uses for attribute names. */
function camelToDash(value: string): string {
	return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * A class list backed by the element's own class attribute.
 *
 * The attribute is the single source of truth, because the app writes classes both ways:
 * `className = "..."` in one place and `classList.add(...)` in another. A list that kept
 * its own copy would silently drop the classes the other way set — toggling "is-lit" onto
 * a word would wipe the "home__tok" that made it a word in the first place.
 */
class FakeClassList {
	private readonly element: FakeElement;

	constructor(element: FakeElement) {
		this.element = element;
	}

	private names(): string[] {
		return (this.element.attributes.class ?? "").split(/\s+/).filter((name) => name.length > 0);
	}

	private write(names: string[]): void {
		this.element.attributes.class = names.join(" ");
	}

	add(...values: string[]): void {
		const names = this.names();
		for (const value of values) if (!names.includes(value)) names.push(value);
		this.write(names);
	}

	remove(...values: string[]): void {
		this.write(this.names().filter((name) => !values.includes(name)));
	}

	contains(value: string): boolean {
		return this.names().includes(value);
	}

	/**
	 * Adds or removes a class. With the second argument it sets the class to exactly that
	 * state, which is how the cover's loop lights one word and unlights the rest.
	 */
	toggle(value: string, force?: boolean): boolean {
		const names = this.names();
		const has = names.includes(value);
		const want = force === undefined ? !has : force;
		if (want && !has) names.push(value);
		if (!want && has) this.write(names.filter((name) => name !== value));
		else this.write(names);
		return want;
	}
}

/**
 * The base of the stub's elements: everything the app can query, click and read.
 *
 * The HTML and SVG flavours are separate classes, because the browser has them separate:
 * an SVG element is an `Element` and **not** an `HTMLElement`, and the app guards its
 * click handlers with one or the other. A single class for both would let a guard written
 * too narrowly pass, and the failure would only show up in the browser — the speaker next
 * to the sentence number is drawn as an SVG, so the guard threw the click away and the
 * button did nothing.
 */
export class FakeElement {
	readonly attributes: Record<string, string> = {};
	/**
	 * The namespace of the element. It decides which of `Element` and `HTMLElement` the
	 * element is an instance of, exactly as in a browser.
	 */
	readonly namespaceURI: "http://www.w3.org/1999/xhtml" | "http://www.w3.org/2000/svg" =
		"http://www.w3.org/1999/xhtml";
	/**
	 * Mirrors the real `dataset` proxy, which writes through to the attribute of the same
	 * name. Without the link, code that sets `el.dataset.foo` and code that reads
	 * `el.getAttribute("data-foo")` would disagree, which they never do in a browser.
	 */
	readonly dataset: Record<string, string> = new Proxy(
		{},
		{
			get: (_target, key: string) => this.attributes[`data-${camelToDash(String(key))}`],
			set: (_target, key: string, value: string) => {
				this.attributes[`data-${camelToDash(String(key))}`] = String(value);
				return true;
			},
			has: (_target, key: string) => `data-${camelToDash(String(key))}` in this.attributes,
			ownKeys: () =>
				Object.keys(this.attributes)
					.filter((name) => name.startsWith("data-"))
					.map((name) => name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())),
			getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
		},
	) as Record<string, string>;

	readonly classList: FakeClassList = new FakeClassList(this);
	readonly children: FakeElement[] = [];
	parentNode: FakeElement | undefined;
	value = "";

	get id(): string {
		return this.attributes.id ?? "";
	}

	set id(value: string) {
		this.attributes.id = String(value);
	}
	readonly listeners = new Map<string, Listener[]>();
	ownerDocument!: FakeDocument;
	/**
	 * Inline style bag; popup positioning writes to it.
	 *
	 * It carries the real CSSStyleDeclaration surface the app uses, including the custom
	 * property methods. A plain object would break `style.setProperty("--i", "2")`, which is
	 * how the cover's words are staggered.
	 */
	readonly style: Record<string, string> & {
		setProperty(name: string, value: string): void;
		removeProperty(name: string): void;
	} = createStyleBag();
	type = "";
	rows = 0;
	placeholder = "";
	focused = false;
	disabled = false;
	title = "";
	hidden = false;
	textContent = "";

	readonly tagName: string;

	/** The reader asks whether the space bar's target is a text field. */
	isContentEditable = false;

	constructor(tagName: string) {
		this.tagName = tagName.toUpperCase();
	}

	get className(): string {
		return this.attributes.class ?? "";
	}

	set className(value: string) {
		this.attributes.class = value;
	}

	setAttribute(name: string, value: string): void {
		this.attributes[name] = value;
	}

	getAttribute(name: string): string | undefined {
		return this.attributes[name];
	}

	removeAttribute(name: string): void {
		delete this.attributes[name];
	}

	addEventListener(type: string, listener: Listener): void {
		const existing = this.listeners.get(type) ?? [];
		existing.push(listener);
		this.listeners.set(type, existing);
	}

	/**
	 * Test helper: fires a click the way the browser would, including bubbling.
	 *
	 * `init` carries the parts of the event the app actually reads — `shiftKey` for the
	 * reader's Shift-and-click gesture, `key` for the space bar. The browser puts them on the
	 * event, so the stub has to as well.
	 */
	fire(type: string, target: FakeElement = this, init: Record<string, unknown> = {}): void {
		const event = {
			type,
			target,
			stopped: false,
			stopPropagation() {
				this.stopped = true;
			},
			...init,
		};
		let node: FakeElement | undefined = this;
		while (node) {
			for (const listener of [...(node.listeners.get(type) ?? [])]) listener(event);
			// The article uses delegated clicks, so propagation must stop at the first handler.
			if (event.stopped) return;
			node = node.parentNode;
		}
	}

	append(...nodes: FakeElement[]): void {
		for (const node of nodes) {
			node.parentNode = this;
			this.children.push(node);
		}
	}

	/** Test helper: a real element's click(), used by the export download anchor. */
	click(): void {
		this.fire("click");
	}

	remove(): void {
		this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1);
		this.parentNode = undefined;
	}

	/** Matches DOM semantics: replacing the children also drops any text node content. */
	replaceChildren(...nodes: FakeElement[]): void {
		this.children.length = 0;
		this.textContent = "";
		this.append(...nodes);
	}

	replaceWith(node: FakeElement): void {
		const siblings = this.parentNode?.children;
		const index = siblings?.indexOf(this) ?? -1;
		if (!siblings || index === -1) return;
		node.parentNode = this.parentNode;
		siblings[index] = node;
		this.parentNode = undefined;
	}

	focus(): void {
		this.focused = true;
	}

	getBoundingClientRect(): { top: number; bottom: number; left: number; right: number; width: number } {
		return { top: 0, bottom: 20, left: 0, right: 0, width: 0 };
	}

	get offsetWidth(): number {
		return 200;
	}

	scrollIntoView(): void {
		// No layout in the stub.
	}

	/** Aggregated text of the subtree. `textContent` is a plain field here and is never
 *  computed from children, so tests read this instead. */
	get textValue(): string {
		return [this.textContent, ...this.children.map((child) => child.textValue)].join("");
	}

	/** Depth-first search over the real attribute/property names this app uses. */
	querySelectorAll(selector: string): FakeElement[] {
		return this.collect(selector);
	}

	querySelector(selector: string): FakeElement | null {
		return this.collect(selector)[0] ?? null;
	}

	/** Walks up the tree; only `#id` and `.class` selectors are needed by this app. */
	closest(selector: string): FakeElement | null {
		const wantedId = selector.startsWith("#") ? selector.slice(1) : undefined;
		const wantedClass = selector.startsWith(".") ? selector.slice(1) : undefined;
		let node: FakeElement | undefined = this;
		while (node) {
			if (wantedId !== undefined && node.attributes.id === wantedId) return node;
			if (wantedClass !== undefined && node.className.split(/\s+/).includes(wantedClass)) return node;
			node = node.parentNode;
		}
		return null;
	}

	private collect(selector: string): FakeElement[] {
		const wanted = selector.startsWith("#") ? selector.slice(1) : undefined;
		const wantedClass = selector.startsWith(".") ? selector.slice(1) : undefined;
		// Attribute selectors, bare (`[data-reveal]`) or with one quoted value
		// (`[data-lit="true"]`). The landing page uses both to style its steps.
		let attributeName: string | undefined;
		let attributeValue: string | undefined;
		if (selector.startsWith("[") && selector.endsWith("]")) {
			const inner = selector.slice(1, -1);
			const equals = inner.indexOf("=");
			attributeName = equals === -1 ? inner : inner.slice(0, equals);
			if (equals !== -1) attributeValue = inner.slice(equals + 1).replace(/^["']|["']$/g, "");
		}
		const found: FakeElement[] = [];
		const walk = (node: FakeElement): void => {
			for (const child of node.children) {
				// Read className rather than classList: the app assigns className directly,
				// which never touches the classList set.
				const classes = child.className.split(/\s+/);
				let matches = false;
				if (wanted) matches = child.attributes.id === wanted;
				else if (wantedClass !== undefined) matches = classes.includes(wantedClass);
				else if (attributeName !== undefined) {
					matches =
						attributeValue === undefined
							? attributeName in child.attributes
							: child.attributes[attributeName] === attributeValue;
				}
				if (matches) found.push(child);
				walk(child);
			}
		};
		walk(this);
		return found;
	}
}

/**
 * An element in the SVG namespace.
 *
 * It is an `Element` and not an `HTMLElement`, which is the whole point of having it: the
 * app's click guards have to accept it.
 */
export class FakeSvgElement extends FakeElement {
	override readonly namespaceURI = "http://www.w3.org/2000/svg" as const;
}

/** An element in the HTML namespace. */
export class FakeHtmlElement extends FakeElement {
	override readonly namespaceURI = "http://www.w3.org/1999/xhtml" as const;
}

/** Builds the element the tag name calls for, in the namespace it belongs to. */
export function createElement(tagName: string): FakeElement {
	return tagName.toLowerCase() === "svg" ? new FakeSvgElement(tagName) : new FakeHtmlElement(tagName);
}

export class FakeDocument {
	readonly documentElement = new FakeHtmlElement("html");
	readonly body = new FakeHtmlElement("body");
	readonly history: FakeHistory = createHistory();
	private readonly windowListeners = new Map<string, Array<(event: unknown) => void>>();
	readonly defaultView = {
		scrollX: 0,
		scrollY: 0,
		innerWidth: 1024,
		history: this.history,
		location: this.history.location,
		addEventListener: (type: string, listener: (event: unknown) => void): void => {
			const existing = this.windowListeners.get(type) ?? [];
			existing.push(listener);
			this.windowListeners.set(type, existing);
		},
		removeEventListener: (type: string, listener: (event: unknown) => void): void => {
			const existing = this.windowListeners.get(type) ?? [];
			this.windowListeners.set(
				type,
				existing.filter((item) => item !== listener),
			);
		},
		/** Timers, so a test can wait for a deferred action. */
		setTimeout: (handler: () => void, timeout?: number): number =>
			setTimeout(handler, timeout) as unknown as number,
		clearTimeout: (timer: number): void => {
			clearTimeout(timer);
		},
		/** Fires a document-level event on the window, the way the browser does. */
		fire: (type: string, init: Record<string, unknown> = {}): void => {
			for (const listener of this.windowListeners.get(type) ?? []) {
				listener({ type, preventDefault: () => {}, ...init });
			}
		},
	};

	addEventListener(type: string, listener: (event: unknown) => void): void {
		this.defaultView.addEventListener(type, listener);
	}

	/**
	 * Test helper: fires a document-level event, e.g. a keydown.
	 *
	 * `init` carries the parts of the event the app reads, such as `key` for the space bar
	 * that stops the reading.
	 */
	fire(type: string, init: Record<string, unknown> = {}): void {
		for (const listener of this.windowListeners.get(type) ?? []) {
			listener({ type, preventDefault: () => {}, ...init });
		}
	}

	createElement(tagName: string): FakeElement {
		const element = createElement(tagName);
		element.ownerDocument = this;
		return element;
	}

	/**
	 * Builds an element in a namespace, the way SVG has to be made.
	 *
	 * An element made this way is an `Element` and not an `HTMLElement`, which is the whole
	 * reason the app has to be careful about what a click target can be.
	 */
	createElementNS(namespace: string, tagName: string): FakeElement {
		const element =
			namespace === "http://www.w3.org/2000/svg" ? new FakeSvgElement(tagName) : new FakeHtmlElement(tagName);
		element.ownerDocument = this;
		return element;
	}

	createTextNode(text: string): FakeElement {
		const element = this.createElement("text");
		element.textContent = text;
		return element;
	}

	createDocumentFragment(): FakeElement {
		return this.createElement("fragment");
	}

	getElementById(id: string): FakeElement | null {
		return this.body.querySelector(`#${id}`);
	}

	querySelector(selector: string): FakeElement | null {
		return this.body.querySelector(selector);
	}
}

function element(doc: FakeDocument, tagName: string, id?: string): FakeElement {
	const created = doc.createElement(tagName);
	if (id) created.attributes.id = id;
	return created;
}

/**
 * A style bag with the surface of a CSSStyleDeclaration.
 *
 * Custom properties live in the same bag as ordinary ones, and a property set to the empty
 * string is the same as a property that was never set — the browser drops it, and code that
 * reads `style.getPropertyValue` would otherwise see a leftover.
 */
function createStyleBag(): Record<string, string> & {
	setProperty(name: string, value: string): void;
	removeProperty(name: string): void;
} {
	const bag: Record<string, string> = {};
	return Object.assign(bag, {
		setProperty(name: string, value: string): void {
			if (value === "") {
				delete bag[name];
				return;
			}
			bag[name] = value;
		},
		removeProperty(name: string): void {
			delete bag[name];
		},
	});
}

/** Builds the same skeleton index.html provides, so main.ts can find every id it requires. */
export function createDocument(): FakeDocument {
	const doc = new FakeDocument();
	doc.body.ownerDocument = doc;
	doc.documentElement.ownerDocument = doc;

	const app = element(doc, "main", "app");

	// Home view: the cover. The demo sentence is the part that moves, so the stub builds it
	// the way index.html does — one element per word, carrying the data its card shows.
	const home = element(doc, "main", "home-view");
	home.attributes.class = "home";
	const homeTheme = element(doc, "button", "home-theme-toggle");
	const homeRungs = element(doc, "button", "home-rungs");
	const homeEnter = element(doc, "button", "home-enter");
	const homeEnterFoot = element(doc, "button", "home-enter-foot");
	const sentenceInner = element(doc, "span", "home-sentence-inner");
	sentenceInner.textContent = "A patient reader climbs one word at a time.";
	const sentence = element(doc, "p", "home-sentence");
	sentence.append(sentenceInner);

	const demoSentence = element(doc, "p", "home-demo-sentence");
	const number = element(doc, "button");
	number.attributes.class = "home__num";
	demoSentence.append(number);
	for (const [word, pos, ipa, gloss] of [
		["The", "art.", "/\u00f0\u0259/", "\u8fd9\uff1b\u90a3"],
		["morning", "n.", "/\u02c8m\u0254\u02d0n\u026a\u014b/", "\u65e9\u6668\uff1b\u4e0a\u5348"],
		["light", "n.", "/la\u026at/", "\u5149\uff1b\u5149\u7ebf"],
		["came", "v.", "/ke\u026am/", "\u6765\uff1b\u6765\u5230"],
		["slowly", "adv.", "/\u02c8slo\u028ali/", "\u7f13\u6162\u5730\uff1b\u6162\u6162\u5730"],
		["over", "prep.", "/\u02c8o\u028av\u0259r/", "\u5728\u2026\u2026\u4e0a\u65b9\uff1b\u8d8a\u8fc7"],
		["the", "art.", "/\u00f0\u0259/", "\u8fd9\uff1b\u90a3"],
		["quiet", "adj.", "/\u02c8kwa\u026a\u0259t/", "\u5b89\u9759\u7684\uff1b\u5b81\u9759\u7684"],
		["river", "n.", "/\u02c8r\u026av\u0259r/", "\u6cb3\uff1b\u6c5f"],
	]) {
		const token = element(doc, "span");
		token.attributes.class = "home__tok";
		token.dataset.word = word;
		token.dataset.pos = pos;
		token.dataset.ipa = ipa;
		token.dataset.gloss = gloss;
		token.textContent = word;
		demoSentence.append(token);
	}

	const glossCard = element(doc, "aside", "home-card-gloss");
	glossCard.attributes.class = "home__card home__card--gloss is-on";
	const glossWord = element(doc, "span", "home-gloss-word");
	const glossPos = element(doc, "span", "home-gloss-pos");
	const glossIpa = element(doc, "p", "home-gloss-ipa");
	const glossMeaning = element(doc, "p", "home-gloss-meaning");
	glossCard.append(glossWord, glossPos, glossIpa, glossMeaning);

	const markCard = element(doc, "aside", "home-card-mark");
	markCard.attributes.class = "home__card home__card--mark";

	const rungs = element(doc, "ol", "rungs");
	for (const index of [0, 1, 2]) {
		const rung = element(doc, "li");
		rung.attributes.class = "rung";
		rung.dataset.reveal = "";
		rung.dataset.i = String(index);
		rungs.append(rung);
	}
	home.append(homeTheme, homeRungs, sentence, demoSentence, glossCard, markCard, homeEnter, homeEnterFoot, rungs);

	// Library view
	const library = element(doc, "section", "library-view");
	library.attributes.class = "library";
	const nav = element(doc, "nav", "library-nav");
	const tools = element(doc, "div", "library-tools");
	const libraryHome = element(doc, "button", "library-home");
	const hint = element(doc, "p", "library-hint");
	hint.attributes.class = "library__hint";
	hint.hidden = true;
	const libraryTheme = element(doc, "button", "library-theme-toggle");
	const wordsButton = element(doc, "button", "words-button");
	const newArticle = element(doc, "button", "new-article");
	const settings = element(doc, "button", "settings-button");
	const trash = element(doc, "button", "delete-toggle");
	tools.append(libraryHome, hint, wordsButton, newArticle, libraryTheme, settings, trash);
	nav.append(tools);
	const grid = element(doc, "div", "article-grid");
	library.append(nav, grid);

	// Vocabulary view: nav, the big count, search/sort, and the card grid. Same ids as
	// index.html, because main.ts requires every one of them before init returns.
	const words = element(doc, "main", "words-view");
	words.attributes.class = "words";
	const wordsNav = element(doc, "nav");
	const wordsBack = element(doc, "button", "words-back");
	const wordsBrand = element(doc, "h1", "words-title");
	const wordsTheme = element(doc, "button", "words-theme-toggle");
	const wordsDrill = element(doc, "button", "words-drill");
	const wordsTools = element(doc, "div");
	wordsTools.append(wordsDrill, wordsTheme);
	wordsNav.append(wordsBack, wordsBrand, wordsTools);

	const wordsIntro = element(doc, "header");
	const wordsTotal = element(doc, "span", "words-total");
	const wordsStats = element(doc, "p", "words-stats");
	wordsIntro.append(wordsTotal, wordsStats);

	const wordsToolbar = element(doc, "div");
	const wordsSearch = element(doc, "input", "words-search");
	const wordsClear = element(doc, "button", "words-clear");
	wordsClear.hidden = true;
	const wordsSort = element(doc, "div", "words-sort");
	for (const [sort, label] of [
		["recent", "最近"],
		["frequent", "高频"],
		["alpha", "A–Z"],
	]) {
		const button = element(doc, "button");
		button.attributes.class = "words__sort-button";
		button.dataset.sort = sort;
		button.setAttribute("aria-pressed", String(sort === "recent"));
		button.textContent = label;
		wordsSort.append(button);
	}
	const wordsCount = element(doc, "p", "words-count");
	wordsToolbar.append(wordsSearch, wordsClear, wordsSort, wordsCount);

	const wordsLoading = element(doc, "p", "words-loading");
	const wordsGrid = element(doc, "div", "words-grid");
	const wordsEmpty = element(doc, "div", "words-empty");
	wordsEmpty.hidden = true;
	const wordsEmptyTitle = element(doc, "h2", "words-empty-title");
	const wordsEmptyText = element(doc, "p", "words-empty-text");
	const wordsEmptyAction = element(doc, "button", "words-empty-action");
	wordsEmpty.append(wordsEmptyTitle, wordsEmptyText, wordsEmptyAction);
	const wordsBody = element(doc, "div");
	wordsBody.append(wordsLoading, wordsGrid, wordsEmpty);
	words.append(wordsNav, wordsIntro, wordsToolbar, wordsBody);

	// Spelling drill: nav with the four-stop order slider, the prompt card, the two aligned
	// letter rows, the answer field and the actions.
	const spell = element(doc, "main", "spell-view");
	spell.attributes.class = "spell";
	const spellNav = element(doc, "nav");
	const spellBack = element(doc, "button", "spell-back");
	const spellBrand = element(doc, "h1", "spell-title");
	const spellTheme = element(doc, "button", "spell-theme-toggle");
	const spellOrder = element(doc, "div", "spell-order");
	const spellThumb = element(doc, "span", "spell-order-thumb");
	spellOrder.append(spellThumb);
	for (const [order, label] of [
		["recent", "最近"],
		["frequent", "高频"],
		["alpha", "A–Z"],
		["error", "易错"],
	]) {
		const button = element(doc, "button");
		button.attributes.class = "spell__order-button";
		button.dataset.order = order;
		button.setAttribute("aria-pressed", String(order === "recent"));
		button.textContent = label;
		spellOrder.append(button);
	}
	const spellTools = element(doc, "div");
	spellTools.append(spellOrder, spellTheme);
	spellNav.append(spellBack, spellBrand, spellTools);

	const spellLoading = element(doc, "p", "spell-loading");
	const spellCard = element(doc, "section", "spell-card");
	const spellProgress = element(doc, "p", "spell-progress");
	const spellMeaning = element(doc, "p", "spell-meaning");
	const spellPos = element(doc, "span", "spell-pos");
	const spellIpa = element(doc, "button", "spell-ipa");
	const spellStage = element(doc, "div", "spell-stage");
	spellStage.hidden = true;
	const spellLegend = element(doc, "p", "spell-legend");
	spellLegend.hidden = true;
	const spellAnswer = element(doc, "input", "spell-answer");
	const spellResult = element(doc, "p", "spell-result");
	const spellPrev = element(doc, "button", "spell-prev");
	const spellRewrite = element(doc, "button", "spell-rewrite");
	const spellSubmit = element(doc, "button", "spell-submit");
	const spellNext = element(doc, "button", "spell-next");
	const spellActions = element(doc, "div");
	spellActions.attributes.class = "spell__actions";
	spellActions.append(spellPrev, spellRewrite, spellSubmit, spellNext);
	const spellFoot = element(doc, "div");
	spellFoot.attributes.class = "spell__foot";
	spellFoot.append(spellActions);
	spellCard.append(spellProgress, spellMeaning, spellPos, spellIpa, spellStage, spellLegend, spellAnswer, spellResult, spellFoot);

	const spellSession = element(doc, "p", "spell-session");
	const spellEmpty = element(doc, "div", "spell-empty");
	spellEmpty.hidden = true;
	const spellEmptyTitle = element(doc, "h2", "spell-empty-title");
	const spellEmptyText = element(doc, "p", "spell-empty-text");
	const spellEmptyAction = element(doc, "button", "spell-empty-action");
	spellEmpty.append(spellEmptyTitle, spellEmptyText, spellEmptyAction);
	spell.append(spellNav, spellLoading, spellCard, spellSession, spellEmpty);

	// Reader view
	const reader = element(doc, "main", "reader-view");
	const readerTopbar = element(doc, "header", "reader-topbar");
	const back = element(doc, "button", "back-button");
	const readerHome = element(doc, "button", "reader-home");
	const readerTopbarTitle = element(doc, "span", "reader-topbar-title");
	const sizeButton = element(doc, "button", "size-button");
	const sizeMenu = element(doc, "div", "size-menu");
	sizeMenu.hidden = true;
	for (const size of ["s", "m", "l"]) {
		const item = element(doc, "button");
		item.attributes.class = "size-menu__item";
		item.dataset.size = size;
		item.setAttribute("aria-pressed", String(size === "m"));
		sizeMenu.append(item);
	}
	const editArticle = element(doc, "button", "edit-article");
	const themeToggle = element(doc, "button", "theme-toggle");
	readerTopbar.append(back, readerHome, readerTopbarTitle, sizeButton, sizeMenu, editArticle, themeToggle);

	const articleTitle = element(doc, "h1", "article-title");
	const articleMeta = element(doc, "p", "article-meta");
	const layoutToggle = element(doc, "div", "layout-toggle");
	for (const layout of ["sentence", "paragraph"]) {
		const button = element(doc, "button");
		button.dataset.layout = layout;
		button.textContent = layout === "sentence" ? "按句" : "按段";
		button.setAttribute("aria-pressed", String(layout === "sentence"));
		layoutToggle.append(button);
	}

	const inputSection = element(doc, "section", "input-section");
	const labelRow = element(doc, "div", "input-label-row");
	labelRow.attributes.class = "note__label-row";
	const label = element(doc, "label", "input-label");
	label.attributes.class = "note__label";
	label.attributes.for = "article-input";
	const expand = element(doc, "button", "input-expand");
	labelRow.append(label, expand);
	const textarea = element(doc, "textarea", "article-input");
	const actions = element(doc, "div", "input-actions");
	actions.attributes.class = "input__actions";
	const confirm = element(doc, "button", "confirm-button");
	const collapse = element(doc, "button", "input-collapse");
	actions.append(confirm, collapse);
	const status = element(doc, "span", "status");
	inputSection.append(labelRow, textarea, actions, status);

	const articleSection = element(doc, "section", "article-section");
	const article = element(doc, "div", "article");
	article.attributes.class = "article-body";
	articleSection.append(article);

	const summarySection = element(doc, "section", "summary-section");
	const summaryLabel = element(doc, "h2", "summary-label");
	const summary = element(doc, "div", "summary");
	summarySection.append(summaryLabel, summary);

	const currentLabel = element(doc, "span", "sentence-current");
	const totalLabel = element(doc, "span", "sentence-total");
	const footBack = element(doc, "a", "reader-foot-back");

	const chatToggle = element(doc, "button", "chat-toggle");
	chatToggle.attributes.class = "tool tool--ask";
	readerTopbar.append(chatToggle);
	const chat = element(doc, "aside", "reader-chat");
	chat.attributes.class = "chat";
	const chatClose = element(doc, "button", "chat-close");
	const chatContextLabel = element(doc, "span", "chat-context-label");
	const chatContextIndex = element(doc, "span", "chat-context-index");
	const chatContextTotal = element(doc, "span", "chat-context-total");
	const chatContextSource = element(doc, "span", "chat-context-source");
	const chatLog = element(doc, "div", "chat-log");
	const chatEmpty = element(doc, "div", "chat-empty");
	const chatChip = element(doc, "button");
	chatChip.attributes.class = "chat-chip";
	chatChip.dataset.prompt = "讲讲这一句";
	chatEmpty.append(chatChip);
	chatLog.append(chatEmpty);
	const chatForm = element(doc, "form", "chat-form");
	const chatInput = element(doc, "textarea", "chat-input");
	const chatSend = element(doc, "button", "chat-send");
	chatForm.append(chatInput, chatSend);
	chat.append(chatContextLabel, chatContextIndex, chatContextTotal, chatContextSource, chatLog, chatForm, chatClose);
	const chatScrim = element(doc, "div", "chat-scrim");

	reader.append(
		readerTopbar,
		articleTitle,
		articleMeta,
		layoutToggle,
		inputSection,
		status,
		article,
		summarySection,
		currentLabel,
		totalLabel,
		footBack,
		chat,
		chatScrim,
	);
	app.append(home, library, words, spell, reader);
	const toast = element(doc, "div", "app-toast");
	toast.attributes.class = "toast";
	doc.body.append(app, toast);
	return doc;
}

/** Records pushState/replaceState and the hash, and can dispatch popstate like a back button. */
export interface FakeHistory {
	stack: unknown[];
	index: number;
	pushState(state: unknown, _title: string, url?: string): void;
	replaceState(state: unknown, _title: string, url?: string): void;
	back(): void;
	location: { hash: string };
}

export function createHistory(): FakeHistory {
	const stack: unknown[] = [null];
	const history: FakeHistory = {
		stack,
		index: 0,
		location: { hash: "" },
		pushState(state, _title, url) {
			stack.length = history.index + 1;
			stack.push(state);
			history.index = stack.length - 1;
			if (url) history.location.hash = url.startsWith("#") ? url : `#${url}`;
		},
		replaceState(state, _title, url) {
			stack[history.index] = state;
			if (url) history.location.hash = url.startsWith("#") ? url : `#${url}`;
		},
		back() {
			if (history.index > 0) history.index -= 1;
		},
	};
	return history;
}

const memory = new Map<string, string>();

/** localStorage stand-in, cleared between tests by `resetStorage()`. */
export function stubStorage(): Storage {
	const storage: Partial<Storage> = {
		getItem: (key: string) => memory.get(key) ?? null,
		setItem: (key: string, value: string) => void memory.set(key, value),
		removeItem: (key: string) => void memory.delete(key),
		clear: () => memory.clear(),
		key: (index: number) => [...memory.keys()][index] ?? null,
		get length() {
			return memory.size;
		},
	};
	return storage as Storage;
}

export function resetStorage(): void {
	memory.clear();
}
