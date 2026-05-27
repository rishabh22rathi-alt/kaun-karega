// Deterministic safety deny-list for Provider Work Intake (Phase 2A).
//
// This is the authoritative RED backstop: if any pattern matches, the resolve
// route blocks the request and never calls / never trusts the AI safety label.
// It is deliberately intent-focused to limit false positives on legitimate
// trades (e.g. a paan/"supari" betel-nut seller, a welder using "katta" in a
// different sense), so several ambiguous terms are matched only in a
// violent/illegal phrase context rather than standalone.
//
// Returns the matched term (for logging) or null.

// Latin / Hinglish patterns. Matched against a normalized (lowercased,
// punctuation→space, collapsed) copy of the text with word-ish boundaries.
const DENY_PATTERNS: RegExp[] = [
  // Sexual / adult
  /\bescorts?\b/,
  /\bgigolo\b/,
  /\bcall\s?girls?\b/,
  /\bprostitut(?:e|es|ion)\b/,
  /\bbrothel\b/,
  /\brand(?:i|ee|iyan)\b/,
  /\bveshya\b/,
  /\bsex(?:ual)?\s?(?:service|services|work|worker|chat|cam)\b/,
  /\badult\s?(?:service|services|content|video|cam)\b/,
  /\b(?:nude|nudity|porn|pornograph(?:y|ic)|xxx)\b/,
  /\bhookups?\b/,

  // Violence for hire / contract killing
  /\bhit\s?man\b/,
  /\bcontract\s?kill(?:er|ing)?\b/,
  /\bhire\s?(?:a\s?)?killer\b/,
  /\bkiller\s?for\s?hire\b/,
  /\bsupari\s?(?:kill|killer|maar|murder|hit|quotation|de\s?do|lena|leni)\b/,
  /\bquotation\s?(?:murder|kill)\b/,
  /\bkill\s?(?:someone|a\s?person|him|her)\b/,
  /\bmurder\s?for\b/,

  // Goons / muscle
  /\bgoondas?\b/,
  /\bgundagardi\b/,
  /\bsupari\s?gang\b/,

  // Weapons / explosives
  /\b(?:weapons?|firearms?)\b/,
  /\b(?:pistol|revolver)s?\b/,
  /\bak[\s-]?47\b/,
  /\b(?:bomb|grenade|explosive|ied)s?\b/,
  /\billegal\s?arms\b/,
  /\bkatta\s?(?:pistol|gun|banata|banाo)?\b/,

  // Fraud / forgery
  /\b(?:fraud|scam|ponzi|phishing|extortion|blackmail)\b/,
  /\bfake\s?(?:document|documents|id|ids|degree|certificate|passport|aadhaar|aadhar|marksheet|currency|notes?)\b/,
  /\b(?:forged|forgery|counterfeit)\b/,

  // Hacking / cyber
  /\bhack(?:ing|er)?\s?(?:account|whatsapp|phone|email|wifi|password)\b/,
  /\b(?:ddos|ransomware|malware|keylogger)\b/,
  /\botp\s?(?:fraud|bypass|hack)\b/,

  // Drugs
  /\b(?:cocaine|heroin|mdma|charas|smack|opium|narcotics?)\b/,
  /\b(?:ganja|weed|drugs?)\s?(?:sell|selling|bech|bechna|supply|delivery)\b/,

  // Trafficking / organs
  /\bhuman\s?trafficking\b/,
  /\borgan\s?(?:sell|sale|selling)\b/,
  /\bkidney\s?(?:sell|sale|selling)\b/,
];

// A small set of Devanagari terms matched as substrings (word boundaries do
// not work cleanly across scripts). Intent-focused, same caveats as above.
const DENY_DEVANAGARI: string[] = [
  "सुपारी मार",
  "सुपारी देना",
  "हथियार",
  "वेश्या",
  "रंडी",
  "गुंडा",
  "कत्ल",
  "नशा बेच",
  "जाली दस्तावेज",
];

function normalizeForSafety(input: string): string {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns the first denied term found, or null. Pure + synchronous; no I/O.
 */
export function findDeniedTerm(input: string): string | null {
  const original = String(input ?? "");
  const normalized = normalizeForSafety(original);
  if (!normalized) return null;

  for (const pattern of DENY_PATTERNS) {
    const m = pattern.exec(normalized);
    if (m) return m[0];
  }
  for (const term of DENY_DEVANAGARI) {
    if (original.includes(term)) return term;
  }
  return null;
}
