/*************************************************
 * ISSUE REPORTS
 *************************************************/
function getIssueReportsSheet_() {
  return getOrCreateSheet("IssueReports", [
    "IssueID",
    "CreatedAt",
    "ReporterRole",
    "ReporterPhone",
    "ReporterName",
    "IssueType",
    "IssuePage",
    "Description",
    "Status",
    "Priority",
    "AdminNotes",
    "ResolvedAt",
  ]);
}

function nextIssueReportId_(sheet) {
  const values = sheet.getDataRange().getValues();
  let maxSeq = 0;

  for (let i = 1; i < values.length; i++) {
    const issueId = String(values[i][0] || "").trim();
    const match = issueId.match(/^IR-(\d+)$/i);
    if (!match) continue;
    const seq = Number(match[1]) || 0;
    if (seq > maxSeq) maxSeq = seq;
  }

  return "IR-" + String(maxSeq + 1).padStart(4, "0");
}

function getReporterInfoForIssue_(phone) {
  const normalizedPhone = normalizePhone10_(phone);
  if (!normalizedPhone) {
    return {
      ReporterRole: "user",
      ReporterPhone: "",
      ReporterName: "",
    };
  }

  const providerRecord =
    typeof getProviderByPhone_ === "function" ? getProviderByPhone_(normalizedPhone) : null;
  if (providerRecord && providerRecord.ok && providerRecord.provider) {
    return {
      ReporterRole: "provider",
      ReporterPhone: normalizedPhone,
      ReporterName: String(
        providerRecord.provider.ProviderName ||
          providerRecord.provider.Name ||
          ""
      ).trim(),
    };
  }

  return {
    ReporterRole: "user",
    ReporterPhone: normalizedPhone,
    ReporterName: "",
  };
}

function submitIssueReport_(data) {
  const issueType = String(data.IssueType || data.issueType || "").trim();
  const issuePage = String(data.IssuePage || data.issuePage || "").trim();
  const description = String(data.Description || data.description || "").trim();
  const phone = normalizePhone10_(data.ReporterPhone || data.phone || data.userPhone);

  if (!phone) return { ok: false, status: "error", error: "Reporter phone required" };
  if (!issueType) return { ok: false, status: "error", error: "Issue type required" };
  if (!issuePage) return { ok: false, status: "error", error: "Issue page required" };
  if (description.length < 10) {
    return { ok: false, status: "error", error: "Description must be at least 10 characters" };
  }

  const sheet = getIssueReportsSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const headers = ensureSheetHeaders_(sheet, [
      "IssueID",
      "CreatedAt",
      "ReporterRole",
      "ReporterPhone",
      "ReporterName",
      "IssueType",
      "IssuePage",
      "Description",
      "Status",
      "Priority",
      "AdminNotes",
      "ResolvedAt",
    ]);
    const reporter = getReporterInfoForIssue_(phone);
    const issueId = nextIssueReportId_(sheet);
    const now = new Date();

    sheet.appendRow(
      buildRowFromData_(headers, {
        IssueID: issueId,
        CreatedAt: now,
        ReporterRole: reporter.ReporterRole,
        ReporterPhone: reporter.ReporterPhone,
        ReporterName: reporter.ReporterName,
        IssueType: issueType,
        IssuePage: issuePage,
        Description: description,
        Status: "open",
        Priority: "normal",
        AdminNotes: "",
        ResolvedAt: "",
      })
    );

    return {
      ok: true,
      status: "success",
      issueId: issueId,
      message: "Issue reported successfully",
    };
  } finally {
    lock.releaseLock();
  }
}

function getIssueReports_(data) {
  const sheet = getIssueReportsSheet_();
  const headers = ensureSheetHeaders_(sheet, [
    "IssueID",
    "CreatedAt",
    "ReporterRole",
    "ReporterPhone",
    "ReporterName",
    "IssueType",
    "IssuePage",
    "Description",
    "Status",
    "Priority",
    "AdminNotes",
    "ResolvedAt",
  ]);
  const values = sheet.getDataRange().getValues();
  const reports = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const item = {};
    for (let j = 0; j < headers.length; j++) {
      item[headers[j]] = row[j];
    }
    if (!String(item.IssueID || "").trim()) continue;

    reports.push({
      IssueID: String(item.IssueID || "").trim(),
      CreatedAt: typeof toIsoDateString_ === "function" ? toIsoDateString_(item.CreatedAt) : String(item.CreatedAt || "").trim(),
      ReporterRole: String(item.ReporterRole || "").trim(),
      ReporterPhone: String(item.ReporterPhone || "").trim(),
      ReporterName: String(item.ReporterName || "").trim(),
      IssueType: String(item.IssueType || "").trim(),
      IssuePage: String(item.IssuePage || "").trim(),
      Description: String(item.Description || "").trim(),
      Status: String(item.Status || "open").trim(),
      Priority: String(item.Priority || "normal").trim(),
      AdminNotes: String(item.AdminNotes || "").trim(),
      ResolvedAt: typeof toIsoDateString_ === "function" ? toIsoDateString_(item.ResolvedAt) : String(item.ResolvedAt || "").trim(),
    });
  }

  reports.sort(function (a, b) {
    return parseTaskDateMs_(b.CreatedAt) - parseTaskDateMs_(a.CreatedAt);
  });

  return {
    ok: true,
    status: "success",
    reports: reports,
  };
}

function updateIssueReportStatus_(data) {
  const issueId = String(data.IssueID || data.issueId || "").trim();
  const nextStatus = String(data.Status || data.status || "").trim().toLowerCase();
  const adminNotes = String(data.AdminNotes || data.adminNotes || "").trim();

  if (!issueId) return { ok: false, status: "error", error: "IssueID required" };
  if (["open", "in_progress", "resolved"].indexOf(nextStatus) === -1) {
    return { ok: false, status: "error", error: "Invalid status" };
  }

  const sheet = getIssueReportsSheet_();
  const headers = ensureSheetHeaders_(sheet, [
    "IssueID",
    "CreatedAt",
    "ReporterRole",
    "ReporterPhone",
    "ReporterName",
    "IssueType",
    "IssuePage",
    "Description",
    "Status",
    "Priority",
    "AdminNotes",
    "ResolvedAt",
  ]);
  const values = sheet.getDataRange().getValues();
  const idxIssueId = findHeaderIndexByAliases_(headers, ["IssueID"]);

  for (let i = 1; i < values.length; i++) {
    const rowIssueId =
      idxIssueId !== -1 && values[i][idxIssueId] !== undefined
        ? String(values[i][idxIssueId]).trim()
        : "";
    if (rowIssueId !== issueId) continue;

    updateRowFromData_(sheet, i + 1, {
      Status: nextStatus,
      AdminNotes: adminNotes,
      ResolvedAt: nextStatus === "resolved" ? new Date() : "",
    });

    return {
      ok: true,
      status: "success",
      issueId: issueId,
      nextStatus: nextStatus,
    };
  }

  return { ok: false, status: "error", error: "Issue report not found" };
}
