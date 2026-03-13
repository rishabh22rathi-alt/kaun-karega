/**
 * Returns tasks created by a given user phone with distribution/response info.
 * Public endpoint (no admin key) for user dashboards.
 */
function getUserTasksForPhone(phone) {
  if (!phone) return [];

  var tasksSheet = getTasksSheet_();
  var taskData = tasksSheet.getDataRange().getValues();
  if (!taskData.length) return [];
  var taskHeaders = taskData[0];
  var idxPhone = headerIndex(taskHeaders, "UserPhone");
  if (idxPhone === -1) {
    idxPhone = headerIndex(taskHeaders, "Phone");
  }
  var idxTaskId = headerIndex(taskHeaders, "TaskID");
  var idxCategory = headerIndex(taskHeaders, "Category");
  var idxArea = headerIndex(taskHeaders, "Area");
  var idxDetails = headerIndex(taskHeaders, "Details");
  var idxUrgency = headerIndex(taskHeaders, "Urgency");
  var idxCreatedAt = headerIndex(taskHeaders, "CreatedAt");
  var idxStatus = headerIndex(taskHeaders, "Status");

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
  var distIdxTask = headerIndex(distHeaders, "TaskID");
  var distIdxSentAt = headerIndex(distHeaders, "SentAt");

  return taskData
    .slice(1)
    .filter(function (row) {
      return idxPhone !== -1 && String(row[idxPhone]) === String(phone);
    })
    .map(function (row) {
      var taskId = row[idxTaskId];
      var taskCreated = row[idxCreatedAt];

      var distRows = distData.slice(1).filter(function (d) {
        return String(d[distIdxTask]) === String(taskId);
      });
      var providersNotified = distRows.length;
      var firstSentAt =
        distRows.length && distIdxSentAt !== -1 ? distRows[0][distIdxSentAt] : "";

      return {
        taskId: taskId,
        category: idxCategory !== -1 ? row[idxCategory] : "",
        area: idxArea !== -1 ? row[idxArea] : "",
        details: idxDetails !== -1 ? row[idxDetails] : "",
        urgency: idxUrgency !== -1 ? row[idxUrgency] : "",
        createdAt: taskCreated,
        providersNotified: providersNotified,
        firstSentAt: firstSentAt,
        status: idxStatus !== -1 ? row[idxStatus] : "",
      };
    });
}
