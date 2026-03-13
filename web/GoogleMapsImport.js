/******************************************************
 * KAUN KAREGA – DIRECT PROVIDER IMPORT (ELECTRICIANS)
 * Source: Google Places API
 * Target: Providers
 * DEDUPE: place_id + phone (PRODUCTION SAFE)
 ******************************************************/

const GOOGLE_PLACES_API_KEY = "AIzaSyC0PcfhB8fitPfxs5b5gtOHI6fIlfVcyYI";
const FIXED_CATEGORY = "Electrician";
const FIXED_CITY = "Jodhpur";

/**
 * MAIN IMPORT FUNCTION
 */
function importElectriciansJodhpur() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Providers");
  if (!sheet) throw new Error("Providers sheet not found");

  // --------------------------------
  // BUILD EXISTING DEDUPE SETS
  // --------------------------------
  const existingPlaceIds = new Set();
  const existingPhones = new Set();

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const rows = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    rows.forEach(r => {
      if (r[6]) existingPlaceIds.add(r[6].toString());
      if (r[2]) existingPhones.add(r[2].toString());
    });
  }

  let imported = 0;
  let nextPageToken = "";
  const LIMIT = 50;

  do {
    let searchUrl =
      "https://maps.googleapis.com/maps/api/place/textsearch/json?query=" +
      encodeURIComponent(`${FIXED_CATEGORY} in ${FIXED_CITY}`) +
      "&key=" + GOOGLE_PLACES_API_KEY;

    if (nextPageToken) {
      searchUrl += "&pagetoken=" + nextPageToken;
      Utilities.sleep(2000);
    }

    const searchRes = UrlFetchApp.fetch(searchUrl);
    const searchData = JSON.parse(searchRes.getContentText());
    if (!searchData.results) break;

    for (const place of searchData.results) {
      if (imported >= LIMIT) break;

      const placeId = place.place_id;
      if (!placeId || existingPlaceIds.has(placeId)) continue;

      const detailsUrl =
        "https://maps.googleapis.com/maps/api/place/details/json?place_id=" +
        placeId +
        "&fields=name,formatted_phone_number,vicinity,address_components&key=" +
        GOOGLE_PLACES_API_KEY;

      const detailsRes = UrlFetchApp.fetch(detailsUrl);
      const details = JSON.parse(detailsRes.getContentText()).result;
      if (!details || !details.formatted_phone_number) continue;

      // Clean phone
      let phone = details.formatted_phone_number.replace(/\D/g, "");
      if (phone.length === 12 && phone.startsWith("91")) {
        phone = phone.substring(2);
      }
      if (!phone || existingPhones.has(phone)) continue;

      // Area extraction
      let rawArea = "";
      if (details.address_components) {
        const areaComp = details.address_components.find(c =>
          c.types.includes("sublocality_level_1") ||
          c.types.includes("neighborhood")
        );
        rawArea = areaComp
          ? areaComp.long_name
          : (details.vicinity || "").split(",")[0];
      } else {
        rawArea = (details.vicinity || "").split(",")[0];
      }

      const finalArea = getMajorArea(rawArea);

      // Generate ProviderID
      const providerId = "PR-" + Date.now() + "-" + imported;

      // INSERT PROVIDER
      sheet.appendRow([
        providerId,
        details.name || "",
        phone,
        FIXED_CATEGORY,
        finalArea || "",
        "no",
        placeId
      ]);

      // Update dedupe sets immediately
      existingPlaceIds.add(placeId);
      existingPhones.add(phone);
      imported++;
    }

    nextPageToken = searchData.next_page_token;

  } while (nextPageToken && imported < LIMIT);

  return { status: "success", imported };
}

/**
 * AREA NORMALIZATION
 */
function getMajorArea(rawArea) {
  if (!rawArea) return "";

  const areaMap = {
    "Sardarpura": ["Jalori Gate", "C Road", "B Road", "Gole Building"],
    "Chopasni Housing Board": ["CHB", "1st Pulia", "2nd Pulia", "3rd Pulia"],
    "Shastri Nagar": ["Medical College", "MDM Hospital", "Sector"],
    "Ratanada": ["Air Force", "Circuit House", "Shikargarh"],
    "Paota": ["Mandore", "Nagaur Road"]
  };

  const text = rawArea.toLowerCase();
  for (let area in areaMap) {
    for (let key of areaMap[area]) {
      if (text.includes(key.toLowerCase())) return area;
    }
  }
  return rawArea;
}
