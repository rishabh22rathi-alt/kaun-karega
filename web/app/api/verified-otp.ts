// pages/api/verify-otp.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getSheetValues, updateSheetRow } from "../../lib/googleSheets";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { phone, otp, requestId } = req.body;

    console.log("Verifying OTP for requestId:", requestId);

    if (!requestId || !otp) {
      return res.status(400).json({
        ok: false,
        error: "Request ID and OTP are required.",
      });
    }

    const normalizedPhone = phone ? phone.toString().trim() : "";
    const enteredOtp = otp.toString().trim();

    if (enteredOtp.length !== 4) {
      return res.status(400).json({
        ok: false,
        error: "OTP must be exactly 4 digits.",
      });
    }

    // Fetch OTP rows from Google Sheets
    const { headers, values } = await getSheetValues("OTP", "OTP!A:F");
    const phoneIndex = 0; // Column A
    const otpIndex = 1; // Column B
    const dateIndex = 2; // Column C
    const statusIndex = 4; // Column E
    const requestIdIndex = 5; // Column F

    let row: Record<string, string> | null = null;
    let rowNumber: number | undefined;

    // Search from bottom to top for latest OTP with this requestId
    for (let i = values.length - 1; i >= 1; i--) {
      const rowValues = values[i] ?? [];
      const rowRequestId = (rowValues[requestIdIndex] ?? "").toString().trim();
      if (rowRequestId !== requestId) continue;

      const mappedRow: Record<string, string> = {};
      headers.forEach((h, idx) => {
        const value = rowValues[idx] ?? "";
        mappedRow[h] = value;
        mappedRow[h.toLowerCase()] = value;
      });

      mappedRow.phone = (rowValues[phoneIndex] ?? "").toString().trim();
      mappedRow.otp = (rowValues[otpIndex] ?? "").toString().trim();
      mappedRow.verified = (rowValues[statusIndex] ?? "").toString().trim();
      mappedRow.date = (rowValues[dateIndex] ?? "").toString().trim();
      mappedRow.requestId = rowRequestId;

      row = mappedRow;
      rowNumber = i + 1;
      break;
    }

    if (!row || !rowNumber) {
      return res.status(404).json({
        ok: false,
        error: "No OTP found for this request ID.",
      });
    }

    const storedOtp = (row.otp ?? "").toString().trim();
    const verified = row.verified ?? "";
    const dateRaw = row.date ?? "";

    if (!storedOtp) {
      return res.status(400).json({ ok: false, error: "Invalid OTP record." });
    }

    const parsedDate = dateRaw ? new Date(dateRaw.toString().trim()) : null;
    const isFreshVerified =
      verified === "YES" &&
      parsedDate instanceof Date &&
      !Number.isNaN(parsedDate.getTime()) &&
      Date.now() - parsedDate.getTime() <= 30 * 24 * 60 * 60 * 1000;

    if (isFreshVerified) {
      return res.status(200).json({
        ok: true,
        status: "success",
        message: "Phone number already verified.",
      });
    }

    if (verified === "YES") {
      return res.status(400).json({ ok: false, error: "Phone number already verified." });
    }

    if (enteredOtp !== storedOtp) {
      console.warn(`[VERIFY OTP FAILED] Phone: ${normalizedPhone}`);
      return res.status(401).json({ ok: false, error: "The OTP you entered is incorrect." });
    }

    // ✅ Mark verified
    await updateSheetRow("OTP", rowNumber, { Verified: "YES" });

    console.log(`[VERIFY OTP SUCCESS] Phone verified: ${normalizedPhone}`);

    return res.status(200).json({
      ok: true,
      status: "success",
      message: "OTP verified successfully.",
    });
  } catch (error) {
    console.error("[VERIFY OTP ERROR]", error);
    return res.status(500).json({ ok: false, error: "Internal server error." });
  }
}
