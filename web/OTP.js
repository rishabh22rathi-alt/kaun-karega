/*************************************************
 * OTP
 *************************************************/
function sendOtp_(data) {
  const phone = normalizePhone10_(data.phone);
  if (!phone) return { ok: false, status: "error", error: "Invalid phone number" };

  const otp = generateOtp4_();
  const now = new Date();

  const dateStr = Utilities.formatDate(now, "Asia/Kolkata", "dd/MM/yyyy");
  const timeStr = Utilities.formatDate(now, "Asia/Kolkata", "HH:mm:ss");
  const requestId = String(Date.now()) + "-" + Math.floor(Math.random() * 1000000);

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_OTP);
  if (!sh) return { ok: false, status: "error", error: "OTP sheet not found: " + SHEET_OTP };

  if (sh.getLastRow() === 0) sh.appendRow(["phone", "OTP", "Date", "Time", "Verified", "requestId"]);
  sh.appendRow([phone, otp, dateStr, timeStr, "NO", requestId]);

  return {
    ok: true,
    status: "success",
    message: "OTP generated",
    phone: phone,
    requestId: requestId,
    otp: otp, // NOTE: testing only. Remove for production.
  };
}

function verifyOtp_(data) {
  const phone = normalizePhone10_(data.phone);
  const otpInput = String(data.otp || "").trim();

  if (!phone) return { ok: false, status: "error", error: "Invalid phone number" };
  if (!otpInput) return { ok: false, status: "error", error: "OTP required" };

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_OTP);
  if (!sh) return { ok: false, status: "error", error: "OTP sheet not found: " + SHEET_OTP };

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok: false, status: "error", error: "No OTP records found" };

  let matchRowIndex = -1;
  for (let i = values.length - 1; i >= 1; i--) {
    const rowPhone = String(values[i][0] || "").trim();
    if (rowPhone === phone) { matchRowIndex = i; break; }
  }
  if (matchRowIndex === -1) return { ok: false, status: "error", error: "No OTP found for phone" };

  const otpSaved = String(values[matchRowIndex][1] || "").trim();
  const verified = String(values[matchRowIndex][4] || "").trim().toUpperCase();

  if (verified === "YES") {
    touchUserLogin_(phone);
    return { ok: true, status: "success", message: "Already verified", phone: phone };
  }

  if (otpSaved !== otpInput) return { ok: false, status: "error", error: "Invalid OTP" };

  sh.getRange(matchRowIndex + 1, 5).setValue("YES");
  touchUserLogin_(phone);

  return { ok: true, status: "success", message: "OTP verified", phone: phone };
}
