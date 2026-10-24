import { describe, expect, it } from "vitest";
import { splitAnalysis } from "../web/analysis.ts";

describe("splitAnalysis", () => {
	it("turns Markdown headings, bullets and emphasis into plain points", () => {
		const points = splitAnalysis(
			[
				"### 整体评价  ",
				"译文基本传达了原意，但**用词**不准确。",
				"",
				"### 逐项差异",
				"- **“进行”应改为“开始”**：原句强调 start。",
				"- **语序**：时间状语应前置。",
			].join("\n"),
		);
		expect(points).toEqual([
			"整体评价",
			"译文基本传达了原意，但用词不准确。",
			"逐项差异",
			"“进行”应改为“开始”：原句强调 start。",
			"语序：时间状语应前置。",
		]);
		expect(points.join("")).not.toMatch(/[#*`]/);
	});

	it("splits numbered points that arrive in one paragraph", () => {
		const points = splitAnalysis(
			"整体评价：译文漏译。主要差异：1）主语误译；2）语序不当；3）用词不准。建议译文：法学研究是基础学科。",
		);
		expect(points.length).toBeGreaterThanOrEqual(4);
		expect(points[0]).toContain("整体评价");
		expect(points.join("")).not.toContain("1）");
		expect(points.join("")).toContain("主语误译");
		expect(points[points.length - 1]).toContain("建议译文");
	});

	it("keeps a plain reply as one point", () => {
		expect(splitAnalysis("整体翻译通顺，只有一处时态需要调整。")).toEqual([
			"整体翻译通顺，只有一处时态需要调整。",
		]);
	});

	it("returns an empty list for empty or decoration-only replies", () => {
		expect(splitAnalysis("")).toEqual([]);
		expect(splitAnalysis("###   \n-  ")).toEqual([]);
	});
});
