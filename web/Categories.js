/*************************************************
 * CATEGORIES
 *************************************************/
function getAllCategoriesFromSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_CATEGORIES);
  if (!sh) return [];

  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0].map((h) => String(h).trim().toLowerCase());
  const idxName = headers.indexOf("category_name");
  const idxActive = headers.indexOf("active");

  const out = [];
  const seen = new Set();

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const name = String((idxName >= 0 ? row[idxName] : row[1]) || "").trim();
    const active = String((idxActive >= 0 ? row[idxActive] : row[2]) || "").trim().toLowerCase();

    if (!name) continue;
    if (active !== "yes") continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(name);
  }

  out.sort((a, b) => a.localeCompare(b));
  return out;
}
