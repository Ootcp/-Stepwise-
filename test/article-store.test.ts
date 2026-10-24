import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The store resolves its root at import time, so the temp directory has to exist and be
 * exported before this module is loaded. That is why the setup lives at the top level
 * rather than in beforeEach.
 */
const dataDir = mkdtempSync(join(tmpdir(), "english-app-articles-"));
process.env.ENGLISH_APP_DATA_DIR = dataDir;

const { articlesDir, createArticle, deleteArticle, isValidArticleId, listArticles, readArticle, updateArticle } =
	await import("../server/store/articles.ts");
import type { SentencePart } from "../server/store/articles.ts";

function fileFor(id: string): string {
	return join(articlesDir(), `${id}.json`);
}

afterEach(() => {
	rmSync(articlesDir(), { recursive: true, force: true });
	mkdirSync(articlesDir(), { recursive: true });
});

describe("article id validation", () => {
	it("accepts the generated id shape", () => {
		expect(isValidArticleId("art-m0k3j2-7f1a")).toBe(true);
	});

	it("rejects anything that could escape the directory", () => {
		expect(isValidArticleId("../secrets")).toBe(false);
		expect(isValidArticleId("art-../../etc/passwd")).toBe(false);
		expect(isValidArticleId("art-UPPER")).toBe(false);
		expect(isValidArticleId("")).toBe(false);
		expect(isValidArticleId(undefined)).toBe(false);
		expect(isValidArticleId(42)).toBe(false);
	});
});

describe("createArticle", () => {
	it("derives the title from the first line and truncates it", () => {
		const long = `${"x".repeat(90)}`;
		const article = createArticle({ text: `${long}\nsecond line` });
		expect(article.title).toHaveLength(60);
		expect(article.sentences).toEqual([]);
	});

	it("uses an explicit title and falls back to the first line", () => {
		const explicit = createArticle({ text: "First line\nBody.", title: "  A Given Title  " });
		expect(explicit.title).toBe("A Given Title");
		const fallback = createArticle({ text: "First line\nBody.", title: "   " });
		expect(fallback.title).toBe("First line");
	});

	it("rejects empty text", () => {
		expect(() => createArticle({ text: "   " })).toThrow();
	});

	it("writes a readable, indented JSON file", () => {
		const article = createArticle({ text: "Hello world." });
		const raw = readFileSync(fileFor(article.id), "utf8");
		expect(raw).toContain('\n\t"title":');
		expect(JSON.parse(raw).text).toBe("Hello world.");
	});

	it("leaves no temp file behind", () => {
		const article = createArticle({ text: "Hello world." });
		expect(() => readFileSync(`${fileFor(article.id)}.tmp`, "utf8")).toThrow();
	});
});

describe("listArticles", () => {
	it("returns newest first", async () => {
		const first = createArticle({ text: "first" });
		await new Promise((resolve) => setTimeout(resolve, 5));
		const second = createArticle({ text: "second" });
		const listed = listArticles();
		expect(listed.map((item) => item.id)).toEqual([second.id, first.id]);
	});

	it("flattens and truncates the preview", () => {
		createArticle({ text: "line one\n\nline   two" });
		expect(listArticles()[0].preview).toBe("line one line two");
	});

	it("skips corrupt files instead of failing the whole listing", () => {
		const good = createArticle({ text: "good" });
		writeFileSync(fileFor("art-broken-0000"), "{ not json", "utf8");
		const listed = listArticles();
		expect(listed.map((item) => item.id)).toEqual([good.id]);
	});
});

describe("readArticle", () => {
	it("returns undefined for unknown and invalid ids", () => {
		expect(readArticle("art-missing-0000")).toBeUndefined();
		expect(readArticle("../escape")).toBeUndefined();
	});

	it("normalizes sentence records and fills missing fields", () => {
		const article = createArticle({ text: "Hello. Bye." });
		updateArticle(article.id, {
			sentences: [
				{ index: 0, text: "Hello.", translation: "你好。", analysis: "", userTranslation: "", updatedAt: 1 },
			],
		});
		const reread = readArticle(article.id);
		expect(reread?.sentences).toHaveLength(1);
		expect(reread?.sentences[0].analysis).toBe("");
	});
});

describe("updateArticle", () => {
	it("updates text, retitles and bumps updatedAt", async () => {
		const article = createArticle({ text: "old text" });
		await new Promise((resolve) => setTimeout(resolve, 5));
		const updated = updateArticle(article.id, { text: "new first line\nrest" });
		expect(updated?.title).toBe("new first line");
		expect(updated?.text).toContain("rest");
		expect(updated?.updatedAt).toBeGreaterThan(article.updatedAt);
	});

	it("keeps createdAt and previous sentences when omitted", () => {
		const article = createArticle({ text: "text" });
		updateArticle(article.id, {
			sentences: [{ index: 0, text: "s", translation: "t", analysis: "a", userTranslation: "u", updatedAt: 1 }],
		});
		const updated = updateArticle(article.id, { text: "changed" });
		expect(updated?.createdAt).toBe(article.createdAt);
		expect(updated?.sentences).toHaveLength(1);
	});

	it("returns undefined for an unknown article", () => {
		expect(updateArticle("art-missing-0000", { text: "x" })).toBeUndefined();
	});
});

describe("sentence parts", () => {
	const PARTS = [
		{ w: "The", r: "定" },
		{ w: "serene", r: "定" },
		{ w: "library", r: "主" },
		{ w: "invites", r: "谓" },
		{ w: "you", r: "宾" },
		{ w: "to stay.", r: "补" },
	];

	it("persists the parts breakdown with the sentence", () => {
		const article = createArticle({ text: "The serene library invites you to stay." });
		updateArticle(article.id, {
			sentences: [{ index: 0, text: "The serene library invites you to stay.", translation: "t", analysis: "a", userTranslation: "u", parts: PARTS, updatedAt: 1 }],
		});
		const reread = readArticle(article.id);
		expect(reread?.sentences[0].parts).toEqual(PARTS);
	});

	it("persists clause blocks and their nested components", () => {
		const text = "The book that I bought yesterday is interesting.";
		const nested = [
			{
				w: "The book that I bought yesterday",
				r: "主",
				sub: [
					{
						w: "that I bought yesterday",
						r: "定",
						clause: true,
						sub: [
							{ w: "I", r: "主" },
							{ w: "bought", r: "谓" },
							{ w: "yesterday", r: "状" },
						],
					},
				],
			},
			{ w: "is", r: "谓" },
			{ w: "interesting", r: "表" },
			{ w: ".", r: "" },
		];
		const article = createArticle({ text });
		updateArticle(article.id, {
			sentences: [{ index: 0, text, translation: "t", analysis: "a", userTranslation: "u", parts: nested, updatedAt: 1 }],
		});
		expect(readArticle(article.id)?.sentences[0].parts).toEqual(nested);
	});

	it("drops malformed part rows and empty words", () => {
		const article = createArticle({ text: "Hello." });
		const updated = updateArticle(article.id, {
			sentences: [
				{
					index: 0,
					text: "Hello.",
					translation: "",
					analysis: "",
					userTranslation: "",
					parts: [
						{ w: "Hello", r: "主" },
						{ w: "", r: "谓" },
						{ w: 5, r: "谓" },
						"not-a-row",
						{ w: ".", r: "" },
					] as unknown as SentencePart[],
					updatedAt: 1,
				},
			],
		});
		expect(updated?.sentences[0].parts).toEqual([
			{ w: "Hello", r: "主" },
			{ w: ".", r: "" },
		]);
	});
	it("fills parts as undefined for records written before the field existed", () => {
		const article = createArticle({ text: "Hello." });
		updateArticle(article.id, {
			sentences: [{ index: 0, text: "Hello.", translation: "t", analysis: "a", userTranslation: "u", updatedAt: 1 }],
		});
		expect(readArticle(article.id)?.sentences[0].parts).toBeUndefined();
	});
});

describe("per-article clicks and grammar", () => {
	it("starts empty", () => {
		const article = createArticle({ text: "Hello world." });
		expect(article.clicks).toEqual({});
		expect(article.weakGrammar).toEqual([]);
	});

	it("stores clicks keyed by lowercase word", () => {
		const article = createArticle({ text: "Hello." });
		const updated = updateArticle(article.id, { clicks: { Serene: 3, linger: 1 } });
		expect(updated?.clicks).toEqual({ serene: 3, linger: 1 });
	});

	it("drops click entries that are not words or have non-positive counts", () => {
		const article = createArticle({ text: "Hello." });
		const updated = updateArticle(article.id, { clicks: { serene: 2, "123": 1, "a b": 1, quiet: 0, loud: -1 } });
		expect(updated?.clicks).toEqual({ serene: 2 });
	});

	it("rounds fractional click counts", () => {
		const article = createArticle({ text: "Hello." });
		expect(updateArticle(article.id, { clicks: { serene: 2.6 } })?.clicks).toEqual({ serene: 3 });
	});

	it("keeps clicks through an unrelated update", () => {
		const article = createArticle({ text: "Hello." });
		updateArticle(article.id, { clicks: { serene: 4 } });
		expect(updateArticle(article.id, { text: "Changed." })?.clicks).toEqual({ serene: 4 });
	});

	it("stores grammar weaknesses and drops rows with no label", () => {
		const article = createArticle({ text: "Hello." });
		const updated = updateArticle(article.id, {
			weakGrammar: [
				{ key: "tense", label: "时态", note: "过去时误用", count: 2 },
				{ key: "", label: "  ", note: "n", count: 1 },
			],
		});
		expect(updated?.weakGrammar).toHaveLength(1);
		expect(updated?.weakGrammar[0].label).toBe("时态");
	});

	it("keeps grammar results through an unrelated update", () => {
		const article = createArticle({ text: "Hello." });
		updateArticle(article.id, { weakGrammar: [{ key: "a", label: "时态", note: "", count: 1 }] });
		expect(updateArticle(article.id, { text: "Changed." })?.weakGrammar).toHaveLength(1);
	});

	it("defaults the count to one when the stored value is missing", () => {
		const article = createArticle({ text: "Hello." });
		const updated = updateArticle(article.id, { weakGrammar: [{ key: "a", label: "冠词", note: "", count: 0 }] });
		expect(updated?.weakGrammar[0].count).toBe(1);
	});

	it("fills the new fields for articles written before they existed", () => {
		const article = createArticle({ text: "Legacy article." });
		writeFileSync(
			fileFor(article.id),
			JSON.stringify({ version: 1, id: article.id, title: "Legacy", text: "Legacy article." }),
			"utf8",
		);
		const reread = readArticle(article.id);
		expect(reread?.clicks).toEqual({});
		expect(reread?.weakGrammar).toEqual([]);
	});
});

describe("deleteArticle", () => {
	it("removes the file and reports success", () => {
		const article = createArticle({ text: "bye" });
		expect(deleteArticle(article.id)).toBe(true);
		expect(readArticle(article.id)).toBeUndefined();
		expect(deleteArticle(article.id)).toBe(false);
	});

	it("refuses invalid ids", () => {
		expect(deleteArticle("../escape")).toBe(false);
	});
});
