// Prompt construction, tool schema, parsing, and the model call for the
// work-intake classifier. Server-only.

import type Anthropic from "@anthropic-ai/sdk";

import {
  getAnthropicClient,
  WORK_INTAKE_MAX_TOKENS,
  WORK_INTAKE_MODEL,
  WORK_INTAKE_TIMEOUT_MS,
} from "@/lib/ai/anthropicClient";
import type { WorkIntakeAiRaw, WorkIntakeSafety } from "@/lib/workIntake/types";

export const WORK_INTAKE_TOOL_NAME = "classify_provider_work";

const SYSTEM_INSTRUCTIONS = `You classify a service provider's free-text description of the work they do.
The provider may write in Hindi, Hinglish, Marwari, or English.

Rules:
- Choose AT MOST ONE main category.
  - If an active category fits, mainCategory MUST be copied EXACTLY from the
    ACTIVE CATEGORIES list and isNew=false.
  - If none fits but the work is a normal/legal service, propose a short clean
    category name in mainCategory and set isNew=true. The proposal MUST be:
      * Title Case (e.g. "Packers & Movers"),
      * 1 to 3 words,
      * at most 30 characters,
      * the CORE business/category name only — NOT the provider's raw sentence,
      * examples: "Packers & Movers", "Furniture Polish", "Pet Grooming",
        "Event Decoration".
    NEVER echo a long natural-language sentence as mainCategory. Specific
    services the provider mentioned go in workTags, not mainCategory.
- MULTI-CATEGORY rule:
  - If the provider mentions multiple unrelated ACTIVE categories (e.g.
    "plumber electrician painting sab karta hu"), do NOT pick one — instead
    leave mainCategory empty, set isNew=false, and list each candidate canonical
    EXACTLY as it appears in the ACTIVE CATEGORIES list in possibleCategories
    (1 to 4 entries).
  - Use possibleCategories ONLY for active matches. Do not list new/proposed
    names there — those go in mainCategory as described above.
  - The provider will be asked to pick a single main service. Do not surface
    workTags that belong to categories the provider would not choose; when in
    doubt, return an empty workTags array on multi-category responses.
- Do NOT invent categories that are not in the list when a listed one fits.
- workTags: 0-6 short specialisation terms the provider mentioned (e.g. tools,
  materials, sub-services). Keep each short. Never include unsafe content.
- confidence: 0..1 for how sure you are about the main category.
- safety classification:
  - "red": illegal/sexual/adult/violent, contract killing (supari), goons,
    weapons, fraud, fake documents, hacking/scams, drugs, or any harmful,
    unethical, or offensive request. Block these.
  - "yellow": unclear, brand-new/unknown service, low confidence, or
    sensitive-but-legal work.
  - "green": a normal, clearly legal service that maps to an active category
    with high confidence.
- Respond ONLY by calling the ${WORK_INTAKE_TOOL_NAME} tool.`;

export const WORK_INTAKE_TOOL: Anthropic.Tool = {
  name: WORK_INTAKE_TOOL_NAME,
  description:
    "Return the single best main category (from the active set, or empty if new), suggested work tags, a confidence score, and a safety classification.",
  input_schema: {
    type: "object",
    properties: {
      mainCategory: {
        type: "string",
        description:
          "Exact active category name when one fits; otherwise a short Title-Case proposed category name, 1–3 words, max 30 chars. Never echo the provider's raw sentence.",
      },
      isNew: {
        type: "boolean",
        description: "True when this is a new/unknown service not in the list.",
      },
      confidence: {
        type: "number",
        description: "0..1 confidence in the chosen main category.",
      },
      safety: {
        type: "string",
        enum: ["green", "yellow", "red"],
      },
      workTags: {
        type: "array",
        items: { type: "string" },
        description: "0-6 short specialisation terms.",
      },
      possibleCategories: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional. When the provider clearly mentions MULTIPLE unrelated ACTIVE categories, list each candidate canonical EXACTLY as in the ACTIVE CATEGORIES list (1–4 entries) and leave mainCategory empty. Do NOT list proposed/new names here.",
      },
    },
    required: ["mainCategory", "isNew", "confidence", "safety", "workTags"],
  },
};

/**
 * Render the candidate block as one line per active canonical, with any known
 * aliases inlined as disambiguation hints. Aliases are NOT membership — the
 * server still decides existence post-AI against the canonical list — but they
 * help the model route phrases like "fan repair" / "cooler wiring" to
 * Electrician instead of guessing AC Repair from surface semantics.
 */
export function buildSystemBlocks(
  candidates: string[],
  aliasesByCanonical?: Map<string, string[]> | Record<string, string[]>
): Anthropic.TextBlockParam[] {
  const aliasLookup =
    aliasesByCanonical instanceof Map
      ? aliasesByCanonical
      : new Map<string, string[]>(
          aliasesByCanonical ? Object.entries(aliasesByCanonical) : []
        );

  const lines = candidates.map((name) => {
    const aliases = aliasLookup.get(name) ?? [];
    return aliases.length > 0 ? `${name}: ${aliases.join(", ")}` : name;
  });
  const list = lines.length > 0 ? lines.join("\n") : "(none)";

  // Both blocks are stable across calls within a short window → prompt-cache
  // them so repeated resolves are cheap (the variable text goes in the user
  // turn, which is not cached).
  return [
    {
      type: "text",
      text: SYSTEM_INSTRUCTIONS,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: `ACTIVE CATEGORIES (candidate set; "Canonical: alias, alias" lines list common ways providers describe that work — pick the canonical, never an alias):\n${list}`,
      cache_control: { type: "ephemeral" },
    },
  ];
}

function buildUserText(text: string, cityCode?: string): string {
  const cityLine = cityCode ? `City: ${cityCode}\n` : "";
  return `${cityLine}Provider description:\n"""${text}"""`;
}

export function parseAiRaw(input: unknown): WorkIntakeAiRaw | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;

  const safetyRaw = String(o.safety ?? "").toLowerCase();
  const safety: WorkIntakeSafety =
    safetyRaw === "green" || safetyRaw === "red" ? safetyRaw : "yellow";

  const mainRaw = typeof o.mainCategory === "string" ? o.mainCategory.trim() : "";
  const mainCategory = mainRaw.length > 0 ? mainRaw : null;

  const confNum =
    typeof o.confidence === "number" ? o.confidence : Number(o.confidence);
  const confidence = Number.isFinite(confNum)
    ? Math.min(1, Math.max(0, confNum))
    : 0;

  const isNew = o.isNew === true || o.isNew === "true";

  const workTags = Array.isArray(o.workTags)
    ? o.workTags.map((t) => String(t ?? "").trim()).filter((t) => t.length > 0)
    : [];

  const possibleCategories = Array.isArray(o.possibleCategories)
    ? o.possibleCategories
        .map((c) => String(c ?? "").trim())
        .filter((c) => c.length > 0)
    : [];

  return {
    mainCategory,
    isNew,
    confidence,
    safety,
    workTags,
    possibleCategories,
  };
}

/**
 * Calls the model and returns a normalized AI raw result. Throws on missing
 * key, timeout, transport error, missing tool_use, or parse failure — the
 * route maps any throw to the AI_UNAVAILABLE manual fallback.
 */
export async function classifyWorkIntake(params: {
  text: string;
  candidates: string[];
  aliasesByCanonical?: Map<string, string[]>;
  cityCode?: string;
}): Promise<WorkIntakeAiRaw> {
  const client = getAnthropicClient();
  if (!client) throw new Error("NO_API_KEY");

  const message = await client.messages.create(
    {
      model: WORK_INTAKE_MODEL,
      max_tokens: WORK_INTAKE_MAX_TOKENS,
      system: buildSystemBlocks(params.candidates, params.aliasesByCanonical),
      tools: [WORK_INTAKE_TOOL],
      tool_choice: { type: "tool", name: WORK_INTAKE_TOOL_NAME },
      messages: [
        { role: "user", content: buildUserText(params.text, params.cityCode) },
      ],
    },
    { timeout: WORK_INTAKE_TIMEOUT_MS, maxRetries: 0 }
  );

  const toolBlock = message.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("NO_TOOL_USE");
  }
  const raw = parseAiRaw(toolBlock.input);
  if (!raw) throw new Error("PARSE_FAILED");
  return raw;
}
