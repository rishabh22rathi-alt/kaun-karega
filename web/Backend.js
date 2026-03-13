/*************************************************
 * KAUNKAREGA – MASTER BACKEND
 * Modules: OTP + Users + Categories + Tasks + Areas + Matching
 *
 * Spreadsheet ID (MAIN DB):
 * 1xCgM4HnsnYj7XEH6786urLH-V2SmOdmi6koijia_zQo
 *
 * Sheets used:
 * 1) OTP: phone | OTP | Date | Time | Verified | requestId
 * 2) Users: phone | first_login_at | last_login_at
 * 3) Categories: category_name | active (yes/no)
 * 4) Tasks: TaskID | UserPhone | Category | Area | Details | Status | CreatedAt | (optional ServiceDate | TimeSlot) | notified_at | responded_at
 * 5) Areas: AreaName | Active (yes/no)
 * 6) ProviderAreas: ProviderID | AreaName | IsActive | Source | CreatedAt | UpdatedAt
 * 7) ProviderServices: ProviderID | ServiceName | IsActive | Source | CreatedAt | UpdatedAt
 * 8) Providers: ProviderID | ProviderName | Phone | Category | Area | Verified
 * 9) ProviderTaskMatches: MatchID | TaskID | ProviderID | ProviderPhone | ProviderName | Category | Area | JobDescription | MatchPriority | Status | CreatedAt | AcceptedAt
 *************************************************/


/*************************************************
 * SECTION 0 — CONFIG
 *************************************************/




/*************************************************
 * SECTION 1 — ENTRY POINTS (doGet / doPost)
 *************************************************/
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action).trim() : "";

  if (action === "version") return json_({ ok:true, version:"vCAT-1", ts:new Date().toISOString() });

  if (action === "get_areas") return json_(getAreas_());

  if (action === "service_stats") {
    const service = (e.parameter.service || "").trim();
    return json_(serviceStats_(service));
  }

  if (action === "get_all_categories") {
    return json_({ ok: true, status: "success", categories: getAllCategoriesFromSheet_() });
  }

  if (action === "match_providers") {
    const service = (e.parameter.service || "").trim();
    const area = (e.parameter.area || "").trim();
    const limit = Math.min(parseInt(e.parameter.limit || "20", 10) || 20, 50);
    return json_(matchProviders_(service, area, limit));
  }

  // ✅ Provider Profile (GET)
  if (action === "get_provider_by_phone") {
    const phone = (e.parameter.phone || "").trim();
    return json_(getProviderByPhone_(phone));
  }

  // ✅ Provider Leads (GET)
  if (action === "get_provider_leads") {
    const providerId = (e.parameter.providerId || "").trim();
    return json_(getProviderLeads_(providerId));
  }

  if (action === "debug_providerServices_headers_") {
    return json_(debug_providerServices_headers_());
  }

  return json_({
    ok: true,
    status: "active",
    ts: new Date().toISOString(),
    hint:
      "Use POST with JSON: " +
      "{action:'send_otp', phone:'9xxxxxxxxx'} OR " +
      "{action:'verify_otp', phone:'9xxxxxxxxx', otp:'1234'} OR " +
      "{action:'submit_task', phone:'9xxxxxxxxx', category:'Plumber', area:'Shastri Nagar', details:'', serviceDate:'2026-02-15', timeSlot:'Morning'} OR " +
      "{action:'get_user_requests', phone:'9xxxxxxxxx'}",
  });
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";

    let data = {};
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return json_({ ok: false, status: "error", error: "Invalid JSON body", raw: raw });
    }

    let action = String(data.action || "").trim();
    if (!action && data.phone) action = "send_otp";

    switch (action) {
      case "ping":
      case "status":
        return json_({ ok: true, status: "active", ts: new Date().toISOString() });

      case "get_all_categories":
        return json_({ ok: true, status: "success", categories: getAllCategoriesFromSheet_() });

      case "get_areas":
        return json_(getAreas_());

      case "send_otp":
        return json_(sendOtp_(data));

      case "verify_otp":
        return json_(verifyOtp_(data));

      case "submit_task":
        return json_(submitTask_(data));

      case "get_user_requests":
        return json_(getUserRequests_(data));

      case "match_providers": {
        const service = String(data.service || data.category || "").trim();
        const area = String(data.area || "").trim();
        const limit = Math.min(parseInt(data.limit || "20", 10) || 20, 50);
        return json_(matchProviders_(service, area, limit));
      }

      case "save_provider_matches":
        return json_(saveProviderMatches_(data));

      case "provider_register": {
        const phone = String(data.phone || "").trim();
        const name  = String(data.name || "").trim();
        const categories = Array.isArray(data.categories) ? data.categories : [];
        const areas = Array.isArray(data.areas) ? data.areas : [];
        return json_(providerRegister(phone, name, categories, areas));
      }

      default:
        return json_({ ok: false, status: "error", error: "Unknown action: " + action });
    }
  } catch (err) {
    return json_({
      ok: false,
      status: "error",
      error: String(err && err.message ? err.message : err),
    });
  }
}


/*************************************************
 * SECTION 2 — AREAS (get_areas)
 *************************************************/


/*************************************************
 * SECTION 3 — OTP (send_otp / verify_otp)
 *************************************************/


/*************************************************
 * SECTION 4 — USERS (touchUserLogin_)
 *************************************************/


/*************************************************
 * SECTION 5 — CATEGORIES
 *************************************************/


/*************************************************
 * SECTION 6 — TASKS (submit_task / get_user_requests)
 *************************************************/


/*************************************************
 * SECTION 7 — MATCHING ENGINE
 *************************************************/


/*************************************************
 * SECTION 7A — PROVIDER TASK MATCH PERSISTENCE
 *************************************************/


/*************************************************
 * SECTION 7B — PROVIDER REGISTER (Normalized mapping)
 *************************************************/


/*************************************************
 * SECTION 7C — PROVIDERS (Profile / Leads)
 *************************************************/
const TAB_PROVIDERS = "Providers";
const TAB_PROVIDER_SERVICES = "ProviderServices";
const TAB_PROVIDER_AREAS = "ProviderAreas";



/*************************************************
 * SECTION 8 — UTILITIES
 *************************************************/
