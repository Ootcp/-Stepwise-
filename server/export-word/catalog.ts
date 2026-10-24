import { templateInfo, type ExportTemplateId } from "../../shared/export-catalog.ts";
import type { TemplateSpec } from "./schema.ts";
import { renderClassicGreen, renderFreshBlue, renderSpellingTest } from "./templates/two-block.ts";
import { renderColorCards } from "./templates/color-cards.ts";
import { renderEbbinghaus } from "./templates/ebbinghaus.ts";
import { renderQuickTable } from "./templates/quick-table.ts";
import { renderClassicComplete, renderHighDensity } from "./templates/vertical-grid.ts";

function spec(id: ExportTemplateId, render: TemplateSpec["render"]): TemplateSpec {
	const info = templateInfo(id);
	return { id, capacity: info.capacity, contentLocked: info.contentLocked, render };
}

/** Every id in shared/export-catalog.ts must have a renderer here (covered by a test). */
export const TEMPLATE_SPECS: Record<ExportTemplateId, TemplateSpec> = {
	"color-cards": spec("color-cards", renderColorCards),
	"classic-green": spec("classic-green", renderClassicGreen),
	"fresh-blue": spec("fresh-blue", renderFreshBlue),
	"spelling-test": spec("spelling-test", renderSpellingTest),
	ebbinghaus: spec("ebbinghaus", renderEbbinghaus),
	"high-density": spec("high-density", renderHighDensity),
	"classic-complete": spec("classic-complete", renderClassicComplete),
	"quick-table": spec("quick-table", renderQuickTable),
};
