/*************************************************
 * AREAS
 *************************************************/
function getAreas_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_AREAS);
  if (!sh) return { ok: false, status: "error", error: "Areas sheet not found: " + SHEET_AREAS };

  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return { ok: true, status: "success", areas: [] };

  const out = [];
  const seen = new Set();

  for (let i = 1; i < values.length; i++) {
    const area = String(values[i][0] || "").trim().replace(/\s+/g, " ");
    const active = String(values[i][1] || "").trim().toLowerCase();

    if (!area) continue;
    if (active !== "yes") continue;

    const key = area.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(area);
  }

  out.sort((a, b) => a.localeCompare(b));
  return { ok: true, status: "success", areas: out };
}
