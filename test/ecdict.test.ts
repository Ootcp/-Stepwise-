import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Point at a path that does not exist so these tests cover the "not installed" behaviour
// without depending on whether the machine has the dictionary.
process.env.ENGLISH_APP_ECDICT_PATH = join(mkdtempSync(join(tmpdir(), "english-app-noecdict-")), "missing.db");

const { ecdictInfo, lookupFromEcdict, pickMeaning, posFromCodes, posFromMeaningLine, resetEcdict } = await import(
	"../server/ecdict.ts"
);

afterEach(() => {
	resetEcdict();
	rmSync(process.env.ENGLISH_APP_ECDICT_PATH ?? "", { force: true });
});

describe("posFromMeaningLine", () => {
	// These are verbatim first lines from the shipped ECDICT file.
	it("reads the standard abbreviation off the translation line", () => {
		expect(posFromMeaningLine("a. 宁静的, 沉着的, 安详的, 晴朗的")).toBe("adj.");
		expect(posFromMeaningLine("vi. 逗留, 消磨, 徘徊")).toBe("vi.");
		expect(posFromMeaningLine("vt. 使跑, 参赛")).toBe("vt.");
		expect(posFromMeaningLine("conj. 因为")).toBe("conj.");
		expect(posFromMeaningLine("adv. 很快地")).toBe("adv.");
		expect(posFromMeaningLine("art. 那")).toBe("art.");
		expect(posFromMeaningLine("n. 跑, 赛跑, 奔跑")).toBe("n.");
		expect(posFromMeaningLine("prep. 为了")).toBe("prep.");
		expect(posFromMeaningLine("int. 啊")).toBe("int.");
	});

	it("returns empty when the line has no leading code", () => {
		expect(posFromMeaningLine("宁静的")).toBe("");
		expect(posFromMeaningLine("")).toBe("");
	});
});

describe("posFromCodes", () => {
	it("maps ECDICT's internal codes, verified against the shipped data", () => {
		expect(posFromCodes("j:100")).toBe("adj.");
		expect(posFromCodes("n:100")).toBe("n.");
		expect(posFromCodes("v:100")).toBe("v.");
		expect(posFromCodes("r:100")).toBe("adv.");
		expect(posFromCodes("a:100")).toBe("art.");
		expect(posFromCodes("i:15/c:85")).toBe("conj.");
	});

	it("prefers the dominant sense", () => {
		expect(posFromCodes("n:15/v:85")).toBe("v.");
		expect(posFromCodes("v:80/n:20")).toBe("v.");
	});

	it("returns empty for missing or malformed input", () => {
		expect(posFromCodes(null)).toBe("");
		expect(posFromCodes("")).toBe("");
		expect(posFromCodes("nonsense")).toBe("");
	});
});

describe("pickMeaning", () => {
	it("strips the code and keeps at most three senses", () => {
		expect(pickMeaning("a. 宁静的, 沉着的, 安详的, 晴朗的")).toBe("宁静的、沉着的、安详的");
		expect(pickMeaning("n. 跑, 赛跑, 奔跑, 奔跑的路程, 趋向")).toBe("跑、赛跑、奔跑");
	});

	it("uses only the first line", () => {
		expect(pickMeaning("a. 朝生暮死的, 短命的, 短暂的\n[医] 暂时的")).toBe("朝生暮死的、短命的、短暂的");
	});

	it("handles full-width punctuation and extra whitespace", () => {
		expect(pickMeaning("a. 宁静的，沉着的，安详的")).toBe("宁静的、沉着的、安详的");
	});

	it("returns empty when there is no translation", () => {
		expect(pickMeaning(null)).toBe("");
		expect(pickMeaning("")).toBe("");
	});
});

describe("installed but unavailable", () => {
	it("reports not installed when the file is missing", () => {
		expect(ecdictInfo().installed).toBe(false);
	});

	it("returns no entries instead of throwing", () => {
		expect(lookupFromEcdict(["serene"])).toEqual({});
	});
});
