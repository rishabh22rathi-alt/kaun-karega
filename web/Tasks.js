/*************************************************
 * TASKS
 *************************************************/
function getTasksSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_TASKS);
  if (!sh) throw new Error("Tasks sheet not found: " + SHEET_TASKS);
  return sh;
}

function makeTaskId_() {
  return "TK-" + Date.now();
}

function submitTask_(data) {
  const phone = normalizePhone10_(data.userPhone || data.phone);
  if (!phone) return { ok: false, status: "error", error: "Invalid phone number" };

  const category = String(data.category || "").trim();
  const area = String(data.area || "").trim();
  const details = String(data.details || data.description || "").trim();

  const serviceDate = String(data.serviceDate || "").trim();
  const timeSlot = String(data.timeSlot || "").trim();

  if (!category) return { ok: false, status: "error", error: "Category required" };
  if (!area) return { ok: false, status: "error", error: "Area required" };

  const sh = getTasksSheet_();

  if (sh.getLastRow() === 0) {
    sh.appendRow([
      "TaskID","UserPhone","Category","Area","Details","Status","CreatedAt",
      "ServiceDate","TimeSlot","notified_at","responded_at"
    ]);
  }

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const idx = (name) => headers.indexOf(name);

  const taskId = makeTaskId_();
  const createdAt = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");

  const row = new Array(headers.length).fill("");

  row[idx("TaskID")] = taskId;
  row[idx("UserPhone")] = phone;
  row[idx("Category")] = category;
  row[idx("Area")] = area;
  row[idx("Details")] = details;
  row[idx("Status")] = "submitted";
  row[idx("CreatedAt")] = createdAt;

  const iServiceDate = idx("ServiceDate");
  const iTimeSlot = idx("TimeSlot");
  const iNotified = idx("notified_at");
  const iResponded = idx("responded_at");

  if (iServiceDate >= 0) row[iServiceDate] = serviceDate;
  if (iTimeSlot >= 0) row[iTimeSlot] = timeSlot;
  if (iNotified >= 0) row[iNotified] = "";
  if (iResponded >= 0) row[iResponded] = "";

  sh.appendRow(row);

  return { ok: true, status: "success", message: "Task submitted", taskId: taskId };
}

function getUserRequests_(data) {
  const phone = normalizePhone10_(data.userPhone || data.phone);
  if (!phone) return { ok: false, status: "error", error: "Invalid phone number" };

  const sh = getTasksSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return { ok: true, status: "success", count: 0, requests: [] };

  const headers = values[0].map((h) => String(h).trim());
  const idx = (name) => headers.indexOf(name);

  const iTaskID = idx("TaskID");
  const iPhone = idx("UserPhone");
  const iCategory = idx("Category");
  const iArea = idx("Area");
  const iDetails = idx("Details");
  const iStatus = idx("Status");
  const iCreated = idx("CreatedAt");
  const iServiceDate = idx("ServiceDate");
  const iTimeSlot = idx("TimeSlot");
  const iNotified = idx("notified_at");
  const iResponded = idx("responded_at");

  if (iPhone === -1) return { ok: false, status: "error", error: 'Missing column "UserPhone"' };

  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (String(row[iPhone] || "").trim() !== phone) continue;

    out.push({
      TaskID: iTaskID >= 0 ? row[iTaskID] : "",
      UserPhone: row[iPhone],
      Category: iCategory >= 0 ? row[iCategory] : "",
      Area: iArea >= 0 ? row[iArea] : "",
      Details: iDetails >= 0 ? row[iDetails] : "",
      Status: iStatus >= 0 ? row[iStatus] : "",
      CreatedAt: iCreated >= 0 ? row[iCreated] : "",
      ServiceDate: iServiceDate >= 0 ? row[iServiceDate] : "",
      TimeSlot: iTimeSlot >= 0 ? row[iTimeSlot] : "",
      notified_at: iNotified >= 0 ? row[iNotified] : "",
      responded_at: iResponded >= 0 ? row[iResponded] : "",
    });
  }

  out.sort((a, b) => String(b.TaskID).localeCompare(String(a.TaskID)));
  return { ok: true, status: "success", count: out.length, requests: out };
}
