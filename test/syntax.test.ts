import { describe, expect, it } from "vitest";
import type { SentencePart } from "../web/api.ts";
import { buildSyntax, clauseLabel, ROLE_ORDER } from "../web/syntax.ts";

/**
 * The panel must never rebuild the sentence from model text. These tests pin the two
 * promises that keeps: the rendered text is the original sentence, and a block is marked as
 * one continuous span.
 */

function textOf(spans: { text: string }[]): string {
	return spans.map((span) => span.text).join("");
}

function rolesOf(spans: { text: string; role: string }[]): [string, string][] {
	return spans.filter((span) => span.role !== "").map((span) => [span.text, span.role]);
}

describe("buildSyntax", () => {
	it("keeps the whole sentence and marks each phrase as one block", () => {
		const sentence = "The quiet library invites you to stay.";
		const parts: SentencePart[] = [
			{ w: "The quiet library", r: "主" },
			{ w: "invites", r: "谓" },
			{ w: "you", r: "宾" },
			{ w: "to stay", r: "补" },
			{ w: ".", r: "" },
		];
		const line = buildSyntax(sentence, parts);
		expect(line).toBeDefined();
		expect(textOf(line!.spans)).toBe(sentence);
		expect(rolesOf(line!.spans)).toEqual([
			["The quiet library", "主"],
			["invites", "谓"],
			["you", "宾"],
			["to stay", "补"],
		]);
		expect(line!.clauses).toEqual([]);
	});

	it("merges neighbouring blocks that share a role", () => {
		const sentence = "He works in the morning.";
		const line = buildSyntax(sentence, [
			{ w: "He", r: "主" },
			{ w: "works", r: "谓" },
			{ w: "in the", r: "状" },
			{ w: "morning", r: "状" },
			{ w: ".", r: "" },
		]);
		expect(line).toBeDefined();
		expect(textOf(line!.spans)).toBe(sentence);
		expect(rolesOf(line!.spans)).toContainEqual(["in the morning", "状"]);
	});

	it("moves a trailing period out of the component's tint", () => {
		const sentence = "The quiet library invites you to stay.";
		const line = buildSyntax(sentence, [
			{ w: "The quiet library", r: "主" },
			{ w: "invites", r: "谓" },
			{ w: "you", r: "宾" },
			{ w: "to stay.", r: "补" },
		]);
		expect(line).toBeDefined();
		expect(rolesOf(line!.spans)).toContainEqual(["to stay", "补"]);
		expect(textOf(line!.spans)).toBe(sentence);
	});

	it("fills words the model skipped with plain text instead of dropping them", () => {
		const sentence = "The quiet library invites you to stay.";
		const line = buildSyntax(sentence, [
			{ w: "The quiet library", r: "主" },
			{ w: "invites", r: "谓" },
			{ w: "to stay", r: "补" },
			{ w: ".", r: "" },
		]);
		expect(line).toBeDefined();
		expect(textOf(line!.spans)).toBe(sentence);
		expect(line!.spans.some((span) => span.role === "" && span.text.includes("you"))).toBe(true);
	});

	it("accepts words whose case differs from the sentence", () => {
		const line = buildSyntax("The quiet library invites you to stay.", [
			{ w: "the quiet library", r: "主" },
			{ w: "INVITES", r: "谓" },
		]);
		expect(line).toBeDefined();
		expect(rolesOf(line!.spans)).toContainEqual(["The quiet library", "主"]);
		expect(rolesOf(line!.spans)).toContainEqual(["invites", "谓"]);
	});

	it("aligns contractions and hyphenated words as single blocks", () => {
		const sentence = "She won't leave this well-known place.";
		const line = buildSyntax(sentence, [
			{ w: "She", r: "主" },
			{ w: "won't leave", r: "谓" },
			{ w: "this well-known place", r: "宾" },
			{ w: ".", r: "" },
		]);
		expect(line).toBeDefined();
		expect(textOf(line!.spans)).toBe(sentence);
		expect(rolesOf(line!.spans)).toContainEqual(["won't leave", "谓"]);
		expect(rolesOf(line!.spans)).toContainEqual(["this well-known place", "宾"]);
	});

	it("marks a clause inside a noun phrase and expands its components below", () => {
		const sentence = "The book that I bought yesterday is interesting.";
		const line = buildSyntax(sentence, [
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
		]);
		expect(line).toBeDefined();
		expect(textOf(line!.spans)).toBe(sentence);
		const subject = line!.spans.find((span) => span.role === "主");
		expect(subject?.text).toBe("The book that I bought yesterday");
		const clause = subject?.children.find((span) => span.clause);
		expect(clause?.text).toBe("that I bought yesterday");
		expect(clause?.role).toBe("定");
		expect(line!.clauses).toHaveLength(1);
		expect(line!.clauses[0].role).toBe("定");
		expect(line!.clauses[0].depth).toBe(1);
		expect(rolesOf(line!.clauses[0].spans)).toEqual([
			["I", "主"],
			["bought", "谓"],
			["yesterday", "状"],
		]);
	});

	it("expands a clause that is itself a top-level component", () => {
		const sentence = "I know that he is right.";
		const line = buildSyntax(sentence, [
			{ w: "I", r: "主" },
			{ w: "know", r: "谓" },
			{
				w: "that he is right",
				r: "宾",
				clause: true,
				sub: [
					{ w: "he", r: "主" },
					{ w: "is", r: "谓" },
					{ w: "right", r: "表" },
				],
			},
			{ w: ".", r: "" },
		]);
		expect(line).toBeDefined();
		expect(textOf(line!.spans)).toBe(sentence);
		expect(line!.clauses).toHaveLength(1);
		expect(line!.clauses[0].role).toBe("宾");
		expect(line!.clauses[0].depth).toBe(0);
		expect(rolesOf(line!.clauses[0].spans)).toEqual([
			["he", "主"],
			["is", "谓"],
			["right", "表"],
		]);
	});

	it("absorbs a restrictive clause the model returned as a sibling", () => {
		const sentence = "The book that I bought yesterday is interesting.";
		const line = buildSyntax(sentence, [
			{ w: "The book", r: "主" },
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
			{ w: "is", r: "谓" },
			{ w: "interesting", r: "表" },
			{ w: ".", r: "" },
		]);
		expect(line).toBeDefined();
		expect(textOf(line!.spans)).toBe(sentence);
		const subject = line!.spans.find((span) => span.role === "主");
		expect(subject?.text).toBe("The book that I bought yesterday");
		const clause = subject?.children.find((span) => span.clause);
		expect(clause?.text).toBe("that I bought yesterday");
		expect(line!.clauses).toHaveLength(1);
		expect(line!.clauses[0].depth).toBe(1);
	});

	it("nests a clause that the model repeated inside an already-marked noun phrase", () => {
		const sentence = "The book that I bought yesterday is interesting.";
		const line = buildSyntax(sentence, [
			{ w: "The book that I bought yesterday", r: "主" },
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
			{ w: "is", r: "谓" },
			{ w: "interesting", r: "表" },
			{ w: ".", r: "" },
		]);
		expect(line).toBeDefined();
		expect(textOf(line!.spans)).toBe(sentence);
		const subject = line!.spans.find((span) => span.role === "主");
		expect(subject?.children.find((span) => span.clause)?.text).toBe("that I bought yesterday");
		expect(line!.clauses).toHaveLength(1);
	});

	it("leaves a comma-separated non-restrictive clause as its own block", () => {
		const sentence = "My brother, who lives in Paris, is a doctor.";
		const line = buildSyntax(sentence, [
			{ w: "My brother", r: "主" },
			{
				w: "who lives in Paris",
				r: "定",
				clause: true,
				sub: [
					{ w: "who", r: "主" },
					{ w: "lives", r: "谓" },
					{ w: "in Paris", r: "状" },
				],
			},
			{ w: "is", r: "谓" },
			{ w: "a doctor", r: "表" },
			{ w: ".", r: "" },
		]);
		expect(line).toBeDefined();
		expect(textOf(line!.spans)).toBe(sentence);
		expect(rolesOf(line!.spans)).toEqual([
			["My brother", "主"],
			["who lives in Paris", "定"],
			["is", "谓"],
			["a doctor", "表"],
		]);
	});

	it("returns undefined when the reply has no usable breakdown", () => {
		const sentence = "The quiet library invites you to stay.";
		expect(buildSyntax(sentence, [])).toBeUndefined();
		expect(buildSyntax(sentence, undefined)).toBeUndefined();
		expect(buildSyntax(sentence, [{ w: "invites", r: "谓" }])).toBeUndefined();
		expect(buildSyntax(sentence, [{ w: ".", r: "" }])).toBeUndefined();
	});

	it("aligns a phrase whose words were pasted without a space", () => {
		const sentence =
			"(47) On the other, it links theseconcepts to everyday realities in a manner which is parallel to the links journalists forge on a daily basis as they cover and comment on the news.";
		const line = buildSyntax(sentence, [
			{ w: "On the other", r: "状" },
			{ w: ",", r: "" },
			{ w: "it", r: "主" },
			{ w: "links", r: "谓" },
			{ w: "these concepts", r: "宾" },
			{ w: "to everyday realities", r: "状" },
			{ w: "in a manner", r: "状" },
			{
				w: "which is parallel to the links journalists forge on a daily basis as they cover and comment on the news",
				r: "定",
				clause: true,
				sub: [
					{ w: "which", r: "主" },
					{ w: "is", r: "谓" },
					{ w: "parallel to the links journalists forge on a daily basis", r: "表" },
					{ w: "as they cover and comment on the news", r: "状" },
				],
			},
			{ w: ".", r: "" },
		]);
		expect(line).toBeDefined();
		expect(textOf(line!.spans)).toBe(sentence);
		// The model split the glued word; the rendered block is still the original run.
		expect(rolesOf(line!.spans)).toContainEqual(["theseconcepts", "宾"]);
		expect(line!.clauses).toHaveLength(1);
		expect(line!.clauses[0].role).toBe("定");
		expect(rolesOf(line!.clauses[0].spans)).toContainEqual(["which", "主"]);
	});

	it("names clauses by their function", () => {
		expect(clauseLabel("定")).toBe("定从");
		expect(clauseLabel("宾")).toBe("宾从");
		expect(clauseLabel("")).toBe("从句");
	});

	it("offers all eight roles to the legend in a stable order", () => {
		expect([...ROLE_ORDER]).toEqual(["主", "谓", "宾", "定", "状", "补", "表", "同"]);
	});
});
