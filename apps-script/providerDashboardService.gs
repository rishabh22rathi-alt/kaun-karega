/**
 * Builds provider dashboard data from sheets.
 */
function getProviderDashboardData(providerId) {
  if (!providerId) {
    throw new Error("Missing providerId");
  }

  var providerSheet = getSheetByName("Master_Providers");
  var providerData = providerSheet.getDataRange().getValues();
  if (!providerData.length) throw new Error("No providers found");
  var pHeaders = providerData[0];
  var pIdIdx = headerIndex(pHeaders, "ProviderID") !== -1 ? headerIndex(pHeaders, "ProviderID") : headerIndex(pHeaders, "ID");
  var pNameIdx = headerIndex(pHeaders, "Name");
  var pPhoneIdx = headerIndex(pHeaders, "Phone");
  var pCatIdx = headerIndex(pHeaders, "Category");
  var pAreaIdx = headerIndex(pHeaders, "Area");
  var pStatusIdx = headerIndex(pHeaders, "Status");

  var provider = null;
  for (var i = 1; i < providerData.length; i++) {
    if (String(providerData[i][pIdIdx]) === String(providerId)) {
      provider = {
        providerId: providerId,
        name: providerData[i][pNameIdx] || "",
        phone: providerData[i][pPhoneIdx] || "",
        categories: toArray(providerData[i][pCatIdx]),
        areas: toArray(providerData[i][pAreaIdx]),
        status: providerData[i][pStatusIdx] || "",
      };
      break;
    }
  }
  if (!provider) throw new Error("Provider not found");

  // Distribution log (received tasks)
  var distSheet = getOrCreateSheet("Distribution_Log", [
    "TaskID",
    "ProviderID",
    "Area",
    "Category",
    "SentAt",
    "Status",
  ]);
  var distData = distSheet.getDataRange().getValues();
  var distHeaders = distData[0];
  var dTaskIdx = headerIndex(distHeaders, "TaskID");
  var dAreaIdx = headerIndex(distHeaders, "Area");
  var dCatIdx = headerIndex(distHeaders, "Category");
  var dSentIdx = headerIndex(distHeaders, "SentAt");
  var received = distData
    .slice(1)
    .filter(function (row) {
      return String(row[headerIndex(distHeaders, "ProviderID")]) === String(providerId);
    })
    .map(function (row) {
      return {
        taskId: row[dTaskIdx],
        category: row[dCatIdx],
        area: row[dAreaIdx],
        sentAt: row[dSentIdx],
        accepted: false,
      };
    });

  // Task responses (accepted)
  var respSheet = getOrCreateSheet("Task_Response_Log", [
    "TaskID",
    "ProviderID",
    "Area",
    "Category",
    "ResponseAt",
    "ResponseStatus",
  ]);
  var respData = respSheet.getDataRange().getValues();
  var respHeaders = respData[0];
  var rTaskIdx = headerIndex(respHeaders, "TaskID");
  var rAreaIdx = headerIndex(respHeaders, "Area");
  var rCatIdx = headerIndex(respHeaders, "Category");
  var rAtIdx = headerIndex(respHeaders, "ResponseAt");

  var acceptedTasks = respData
    .slice(1)
    .filter(function (row) {
      return String(row[headerIndex(respHeaders, "ProviderID")]) === String(providerId);
    })
    .map(function (row) {
      return {
        taskId: row[rTaskIdx],
        category: row[rCatIdx],
        area: row[rAreaIdx],
        acceptedAt: row[rAtIdx],
      };
    });

  // Mark accepted in received list
  var acceptedTaskIds = {};
  acceptedTasks.forEach(function (t) {
    acceptedTaskIds[String(t.taskId)] = true;
  });
  received = received.map(function (t) {
    t.accepted = !!acceptedTaskIds[String(t.taskId)];
    return t;
  });

  // Reviews
  var reviewSheet = getOrCreateSheet("Reviews", [
    "RoomID",
    "ReviewerPhone",
    "ReviewerRole",
    "Rating",
    "ReviewText",
    "Timestamp",
  ]);
  var reviewData = reviewSheet.getDataRange().getValues();
  var reviewHeaders = reviewData[0];
  var reviews = reviewData.slice(1).map(function (row, idx) {
    return {
      reviewId: "R-" + (idx + 1),
      rating: Number(row[headerIndex(reviewHeaders, "Rating")] || 0),
      comment: row[headerIndex(reviewHeaders, "ReviewText")] || "",
      userPhone: row[headerIndex(reviewHeaders, "ReviewerPhone")] || "",
      createdAt: row[headerIndex(reviewHeaders, "Timestamp")] || "",
    };
  });

  var tasksReceived = received.length;
  var tasksAccepted = acceptedTasks.length;
  var responseRate = tasksReceived ? Math.round((tasksAccepted / tasksReceived) * 100) : 0;

  return {
    provider: provider,
    stats: {
      tasksReceived: tasksReceived,
      tasksAccepted: tasksAccepted,
      responseRate: responseRate,
    },
    tasksReceived: received,
    tasksAccepted: acceptedTasks,
    reviews: reviews,
  };
}
