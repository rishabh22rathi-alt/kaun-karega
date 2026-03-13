function testSheetConnection() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Tasks");
  
  if (sheet) {
    console.log("Success! Found the Tasks sheet.");
    // This will try to write a dummy row to your sheet
    sheet.appendRow(["TEST-101", "0000000000", "Testing", "Sardarpura", "Testing Connection", "Pending", new Date()]);
  } else {
    console.log("Error: Could not find a sheet named 'Tasks'. Please check your tab names at the bottom of the Google Sheet.");
  }
}