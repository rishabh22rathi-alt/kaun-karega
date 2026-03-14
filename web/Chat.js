/*************************************************
 * CHAT SHEETS
 *************************************************/
function getChatThreadsSheet_() {
  const sheet = getOrCreateSheet(SHEET_CHAT_THREADS, [
    "ThreadID",
    "TaskID",
    "UserPhone",
    "ProviderID",
    "LastMessage",
    "LastMessageAt",
    "UnreadUser",
    "UnreadProvider",
    "CreatedAt",
    "Status",
    "ClosedBy",
    "ClosedAt",
    "BlockedFlag",
    "BlockedReason",
    "LastSenderType",
  ]);

  ensureSheetHeaders_(sheet, [
    "ThreadID",
    "TaskID",
    "UserPhone",
    "ProviderID",
    "LastMessage",
    "LastMessageAt",
    "UnreadUser",
    "UnreadProvider",
    "CreatedAt",
    "Status",
    "ClosedBy",
    "ClosedAt",
    "BlockedFlag",
    "BlockedReason",
    "LastSenderType",
  ]);

  return sheet;
}

function getChatsSheet_() {
  const sheet = getOrCreateSheet(SHEET_CHATS, [
    "ChatID",
    "ThreadID",
    "TaskID",
    "UserPhone",
    "ProviderID",
    "SenderType",
    "MessageText",
    "CreatedAt",
    "ReadByUser",
    "ReadByProvider",
  ]);

  ensureSheetHeaders_(sheet, [
    "ChatID",
    "ThreadID",
    "TaskID",
    "UserPhone",
    "ProviderID",
    "SenderType",
    "MessageText",
    "CreatedAt",
    "ReadByUser",
    "ReadByProvider",
  ]);

  return sheet;
}

function getBlockedWordsSheet_() {
  const sheet = getOrCreateSheet(SHEET_BLOCKED_WORDS, [
    "Word",
    "Active",
    "Severity",
  ]);

  ensureSheetHeaders_(sheet, [
    "Word",
    "Active",
    "Severity",
  ]);

  return sheet;
}

function nextThreadId_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return "TH-0001";

  let maxSeq = 0;
  for (let i = 1; i < values.length; i++) {
    const threadId = String(values[i][0] || "").trim();
    const match = threadId.match(/^TH-(\d+)$/i);
    if (!match) continue;

    const seq = Number(match[1]) || 0;
    if (seq > maxSeq) maxSeq = seq;
  }

  return "TH-" + ("000" + (maxSeq + 1)).slice(-4);
}

function nextChatId_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return "CH-0001";

  let maxSeq = 0;
  for (let i = 1; i < values.length; i++) {
    const chatId = String(values[i][0] || "").trim();
    const match = chatId.match(/^CH-(\d+)$/i);
    if (!match) continue;

    const seq = Number(match[1]) || 0;
    if (seq > maxSeq) maxSeq = seq;
  }

  return "CH-" + ("000" + (maxSeq + 1)).slice(-4);
}

function createChatThread_(data) {
  const taskId = String(data.TaskID || data.taskId || "").trim();
  const providerId = String(data.ProviderID || data.providerId || "").trim();
  const userPhone = normalizePhone10_(data.UserPhone || data.userPhone || data.phone);

  if (!taskId) return { ok: false, status: "error", error: "TaskID required" };
  if (!providerId) return { ok: false, status: "error", error: "ProviderID required" };
  if (!userPhone) return { ok: false, status: "error", error: "Invalid phone number" };

  const sheet = getChatThreadsSheet_();
  const values = sheet.getDataRange().getValues();
  const headers = values.length ? values[0].map(function (header) {
    return String(header).trim();
  }) : [];
  const idxTaskId = headers.indexOf("TaskID");
  const idxProviderId = headers.indexOf("ProviderID");
  const idxThreadId = headers.indexOf("ThreadID");

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const rowTaskId = idxTaskId >= 0 ? String(row[idxTaskId] || "").trim() : "";
    const rowProviderId = idxProviderId >= 0 ? String(row[idxProviderId] || "").trim() : "";

    if (rowTaskId === taskId && rowProviderId === providerId) {
      return {
        ok: true,
        status: "success",
        threadId: idxThreadId >= 0 ? String(row[idxThreadId] || "").trim() : "",
      };
    }
  }

  const threadId = nextThreadId_(sheet);
  const createdAt = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");

  sheet.appendRow([
    threadId,
    taskId,
    userPhone,
    providerId,
    "",
    "",
    0,
    0,
    createdAt,
    "active",
    "",
    "",
    "no",
    "",
    "",
  ]);

  return { ok: true, status: "success", threadId: threadId };
}

function sendChatMessage_(data) {
  const threadId = String(data.ThreadID || data.threadId || "").trim();
  const taskId = String(data.TaskID || data.taskId || "").trim();
  const providerId = String(data.ProviderID || data.providerId || "").trim();
  const userPhone = normalizePhone10_(data.UserPhone || data.userPhone || data.phone);
  const senderType = String(data.SenderType || data.senderType || "").trim().toLowerCase();
  const messageText = String(data.MessageText || data.messageText || "").trim();

  if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };
  if (!taskId) return { ok: false, status: "error", error: "TaskID required" };
  if (!providerId) return { ok: false, status: "error", error: "ProviderID required" };
  if (!userPhone) return { ok: false, status: "error", error: "Invalid phone number" };
  if (senderType !== "user" && senderType !== "provider") {
    return { ok: false, status: "error", error: "SenderType must be user or provider" };
  }
  if (!messageText) return { ok: false, status: "error", error: "MessageText required" };

  const threadsSheet = getChatThreadsSheet_();
  const values = threadsSheet.getDataRange().getValues();
  const headers = values.length ? values[0].map(function (header) {
    return String(header).trim();
  }) : [];
  const idxThreadId = headers.indexOf("ThreadID");
  const idxLastMessage = headers.indexOf("LastMessage");
  const idxLastMessageAt = headers.indexOf("LastMessageAt");
  const idxUnreadUser = headers.indexOf("UnreadUser");
  const idxUnreadProvider = headers.indexOf("UnreadProvider");
  const idxStatus = headers.indexOf("Status");
  const idxBlockedFlag = headers.indexOf("BlockedFlag");
  const idxBlockedReason = headers.indexOf("BlockedReason");
  const idxLastSenderType = headers.indexOf("LastSenderType");
  let threadRowNumber = 0;
  let threadRow = null;

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const rowThreadId = idxThreadId >= 0 ? String(row[idxThreadId] || "").trim() : "";
    if (rowThreadId !== threadId) continue;
    threadRowNumber = i + 1;
    threadRow = row.slice();
    break;
  }

  if (!threadRowNumber || !threadRow) {
    return { ok: false, status: "error", error: "Chat thread not found" };
  }

  if (idxStatus >= 0 && String(threadRow[idxStatus] || "").trim().toLowerCase() === "closed") {
    return { ok: false, status: "error", error: "Chat is closed" };
  }

  const blockedWordsSheet = getBlockedWordsSheet_();
  const blockedWordValues = blockedWordsSheet.getDataRange().getValues();
  const blockedWordHeaders = blockedWordValues.length ? blockedWordValues[0].map(function (header) {
    return String(header).trim();
  }) : [];
  const idxWord = blockedWordHeaders.indexOf("Word");
  const idxActive = blockedWordHeaders.indexOf("Active");
  const normalizedMessage = messageText.toLowerCase();
  let hasBlockedLanguage = false;

  for (let i = 1; i < blockedWordValues.length; i++) {
    const row = blockedWordValues[i] || [];
    const isActive =
      idxActive >= 0 ? String(row[idxActive] || "").trim().toLowerCase() === "yes" : false;
    const blockedWord = idxWord >= 0 ? String(row[idxWord] || "").trim().toLowerCase() : "";

    if (!isActive || !blockedWord) continue;
    if (normalizedMessage.indexOf(blockedWord) === -1) continue;

    hasBlockedLanguage = true;
    break;
  }

  if (hasBlockedLanguage) {
    while (threadRow.length < headers.length) threadRow.push("");
    if (idxBlockedFlag >= 0) threadRow[idxBlockedFlag] = "yes";
    if (idxBlockedReason >= 0) threadRow[idxBlockedReason] = "offensive language detected";
    threadsSheet.getRange(threadRowNumber, 1, 1, headers.length).setValues([threadRow]);
    return { ok: false, status: "error", error: "Message contains restricted language" };
  }

  const chatsSheet = getChatsSheet_();
  const chatId = nextChatId_(chatsSheet);
  const createdAt = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");
  const readByUser = senderType === "user" ? "yes" : "no";
  const readByProvider = senderType === "provider" ? "yes" : "no";

  chatsSheet.appendRow([
    chatId,
    threadId,
    taskId,
    userPhone,
    providerId,
    senderType,
    messageText,
    createdAt,
    readByUser,
    readByProvider,
  ]);

  while (threadRow.length < headers.length) threadRow.push("");

  if (idxLastMessage >= 0) threadRow[idxLastMessage] = messageText;
  if (idxLastMessageAt >= 0) threadRow[idxLastMessageAt] = createdAt;
  if (idxLastSenderType >= 0) threadRow[idxLastSenderType] = senderType;

  if (senderType === "provider" && idxUnreadUser >= 0) {
    threadRow[idxUnreadUser] = (Number(threadRow[idxUnreadUser]) || 0) + 1;
  }

  if (senderType === "user" && idxUnreadProvider >= 0) {
    threadRow[idxUnreadProvider] = (Number(threadRow[idxUnreadProvider]) || 0) + 1;
  }

  threadsSheet.getRange(threadRowNumber, 1, 1, headers.length).setValues([threadRow]);

  return { ok: true, status: "success", chatId: chatId, threadId: threadId };
}

function getChatMessages_(data) {
  const threadId = String(data.ThreadID || data.threadId || "").trim();
  if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };

  const sheet = getChatsSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return { ok: true, status: "success", messages: [] };
  }

  const headers = values[0].map(function (header) {
    return String(header).trim();
  });
  const idxThreadId = headers.indexOf("ThreadID");
  const idxChatId = headers.indexOf("ChatID");
  const idxTaskId = headers.indexOf("TaskID");
  const idxUserPhone = headers.indexOf("UserPhone");
  const idxProviderId = headers.indexOf("ProviderID");
  const idxSenderType = headers.indexOf("SenderType");
  const idxMessageText = headers.indexOf("MessageText");
  const idxCreatedAt = headers.indexOf("CreatedAt");
  const idxReadByUser = headers.indexOf("ReadByUser");
  const idxReadByProvider = headers.indexOf("ReadByProvider");
  const messages = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const rowThreadId = idxThreadId >= 0 ? String(row[idxThreadId] || "").trim() : "";
    if (rowThreadId !== threadId) continue;

    messages.push({
      ChatID: idxChatId >= 0 ? row[idxChatId] : "",
      ThreadID: rowThreadId,
      TaskID: idxTaskId >= 0 ? row[idxTaskId] : "",
      UserPhone: idxUserPhone >= 0 ? row[idxUserPhone] : "",
      ProviderID: idxProviderId >= 0 ? row[idxProviderId] : "",
      SenderType: idxSenderType >= 0 ? row[idxSenderType] : "",
      MessageText: idxMessageText >= 0 ? row[idxMessageText] : "",
      CreatedAt: idxCreatedAt >= 0 ? row[idxCreatedAt] : "",
      ReadByUser: idxReadByUser >= 0 ? row[idxReadByUser] : "",
      ReadByProvider: idxReadByProvider >= 0 ? row[idxReadByProvider] : "",
    });
  }

  messages.sort(function (a, b) {
    return parseTaskDateMs_(a.CreatedAt) - parseTaskDateMs_(b.CreatedAt);
  });

  return { ok: true, status: "success", messages: messages };
}

function getUserTaskThreads_(data) {
  const taskId = String(data.TaskID || data.taskId || "").trim();
  const userPhone = normalizePhone10_(data.UserPhone || data.userPhone || data.phone);

  if (!taskId) return { ok: false, status: "error", error: "TaskID required" };
  if (!userPhone) return { ok: false, status: "error", error: "Invalid phone number" };

  const sheet = getChatThreadsSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return { ok: true, status: "success", threads: [] };
  }

  const headers = values[0].map(function (header) {
    return String(header).trim();
  });
  const idxThreadId = headers.indexOf("ThreadID");
  const idxTaskId = headers.indexOf("TaskID");
  const idxUserPhone = headers.indexOf("UserPhone");
  const idxProviderId = headers.indexOf("ProviderID");
  const idxLastMessage = headers.indexOf("LastMessage");
  const idxLastMessageAt = headers.indexOf("LastMessageAt");
  const idxUnreadUser = headers.indexOf("UnreadUser");
  const idxUnreadProvider = headers.indexOf("UnreadProvider");
  const idxCreatedAt = headers.indexOf("CreatedAt");
  const idxStatus = headers.indexOf("Status");
  const idxClosedBy = headers.indexOf("ClosedBy");
  const idxClosedAt = headers.indexOf("ClosedAt");
  const idxBlockedFlag = headers.indexOf("BlockedFlag");
  const idxBlockedReason = headers.indexOf("BlockedReason");
  const idxLastSenderType = headers.indexOf("LastSenderType");
  const threads = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const rowTaskId = idxTaskId >= 0 ? String(row[idxTaskId] || "").trim() : "";
    const rowUserPhone = idxUserPhone >= 0 ? String(row[idxUserPhone] || "").trim() : "";

    if (rowTaskId !== taskId || rowUserPhone !== userPhone) continue;

    threads.push({
      ThreadID: idxThreadId >= 0 ? row[idxThreadId] : "",
      TaskID: rowTaskId,
      UserPhone: rowUserPhone,
      ProviderID: idxProviderId >= 0 ? row[idxProviderId] : "",
      LastMessage: idxLastMessage >= 0 ? row[idxLastMessage] : "",
      LastMessageAt: idxLastMessageAt >= 0 ? row[idxLastMessageAt] : "",
      UnreadUser: idxUnreadUser >= 0 ? row[idxUnreadUser] : "",
      UnreadProvider: idxUnreadProvider >= 0 ? row[idxUnreadProvider] : "",
      CreatedAt: idxCreatedAt >= 0 ? row[idxCreatedAt] : "",
      Status: idxStatus >= 0 ? row[idxStatus] : "",
      ClosedBy: idxClosedBy >= 0 ? row[idxClosedBy] : "",
      ClosedAt: idxClosedAt >= 0 ? row[idxClosedAt] : "",
      BlockedFlag: idxBlockedFlag >= 0 ? row[idxBlockedFlag] : "",
      BlockedReason: idxBlockedReason >= 0 ? row[idxBlockedReason] : "",
      LastSenderType: idxLastSenderType >= 0 ? row[idxLastSenderType] : "",
    });
  }

  threads.sort(function (a, b) {
    const aTime = parseTaskDateMs_(a.LastMessageAt || a.CreatedAt);
    const bTime = parseTaskDateMs_(b.LastMessageAt || b.CreatedAt);
    return bTime - aTime;
  });

  return { ok: true, status: "success", threads: threads };
}

function getProviderThreads_(data) {
  const providerId = String(data.ProviderID || data.providerId || "").trim();
  if (!providerId) return { ok: false, status: "error", error: "ProviderID required" };

  const sheet = getChatThreadsSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return { ok: true, status: "success", threads: [] };
  }

  const headers = values[0].map(function (header) {
    return String(header).trim();
  });
  const idxThreadId = headers.indexOf("ThreadID");
  const idxTaskId = headers.indexOf("TaskID");
  const idxUserPhone = headers.indexOf("UserPhone");
  const idxProviderId = headers.indexOf("ProviderID");
  const idxLastMessage = headers.indexOf("LastMessage");
  const idxLastMessageAt = headers.indexOf("LastMessageAt");
  const idxUnreadUser = headers.indexOf("UnreadUser");
  const idxUnreadProvider = headers.indexOf("UnreadProvider");
  const idxCreatedAt = headers.indexOf("CreatedAt");
  const threads = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const rowProviderId = idxProviderId >= 0 ? String(row[idxProviderId] || "").trim() : "";
    if (rowProviderId !== providerId) continue;

    threads.push({
      ThreadID: idxThreadId >= 0 ? row[idxThreadId] : "",
      TaskID: idxTaskId >= 0 ? row[idxTaskId] : "",
      UserPhone: idxUserPhone >= 0 ? row[idxUserPhone] : "",
      ProviderID: rowProviderId,
      LastMessage: idxLastMessage >= 0 ? row[idxLastMessage] : "",
      LastMessageAt: idxLastMessageAt >= 0 ? row[idxLastMessageAt] : "",
      UnreadUser: idxUnreadUser >= 0 ? row[idxUnreadUser] : "",
      UnreadProvider: idxUnreadProvider >= 0 ? row[idxUnreadProvider] : "",
      CreatedAt: idxCreatedAt >= 0 ? row[idxCreatedAt] : "",
    });
  }

  threads.sort(function (a, b) {
    const aTime = parseTaskDateMs_(a.LastMessageAt || a.CreatedAt);
    const bTime = parseTaskDateMs_(b.LastMessageAt || b.CreatedAt);
    return bTime - aTime;
  });

  return { ok: true, status: "success", threads: threads };
}

function markChatRead_(data) {
  const threadId = String(data.ThreadID || data.threadId || "").trim();
  const readerType = String(data.ReaderType || data.readerType || "").trim().toLowerCase();

  if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };
  if (readerType !== "user" && readerType !== "provider") {
    return { ok: false, status: "error", error: "ReaderType must be user or provider" };
  }

  const threadsSheet = getChatThreadsSheet_();
  const threadValues = threadsSheet.getDataRange().getValues();
  const threadHeaders = threadValues.length ? threadValues[0].map(function (header) {
    return String(header).trim();
  }) : [];
  const idxThreadId = threadHeaders.indexOf("ThreadID");
  const idxUnreadUser = threadHeaders.indexOf("UnreadUser");
  const idxUnreadProvider = threadHeaders.indexOf("UnreadProvider");
  let threadRowNumber = 0;
  let threadRow = null;

  for (let i = 1; i < threadValues.length; i++) {
    const row = threadValues[i] || [];
    const rowThreadId = idxThreadId >= 0 ? String(row[idxThreadId] || "").trim() : "";
    if (rowThreadId !== threadId) continue;
    threadRowNumber = i + 1;
    threadRow = row.slice();
    break;
  }

  if (!threadRowNumber || !threadRow) {
    return { ok: false, status: "error", error: "Chat thread not found" };
  }

  while (threadRow.length < threadHeaders.length) threadRow.push("");

  if (readerType === "user" && idxUnreadUser >= 0) {
    threadRow[idxUnreadUser] = 0;
  }

  if (readerType === "provider" && idxUnreadProvider >= 0) {
    threadRow[idxUnreadProvider] = 0;
  }

  threadsSheet.getRange(threadRowNumber, 1, 1, threadHeaders.length).setValues([threadRow]);

  const chatsSheet = getChatsSheet_();
  const chatValues = chatsSheet.getDataRange().getValues();
  if (chatValues.length > 1) {
    const chatHeaders = chatValues[0].map(function (header) {
      return String(header).trim();
    });
    const idxChatThreadId = chatHeaders.indexOf("ThreadID");
    const idxReadByUser = chatHeaders.indexOf("ReadByUser");
    const idxReadByProvider = chatHeaders.indexOf("ReadByProvider");
    const updatedRows = [];
    const updatedRowNumbers = [];

    for (let i = 1; i < chatValues.length; i++) {
      const row = chatValues[i] || [];
      const rowThreadId = idxChatThreadId >= 0 ? String(row[idxChatThreadId] || "").trim() : "";
      if (rowThreadId !== threadId) continue;

      const updatedRow = row.slice();
      while (updatedRow.length < chatHeaders.length) updatedRow.push("");

      if (readerType === "user" && idxReadByUser >= 0) {
        updatedRow[idxReadByUser] = "yes";
      }

      if (readerType === "provider" && idxReadByProvider >= 0) {
        updatedRow[idxReadByProvider] = "yes";
      }

      updatedRows.push(updatedRow);
      updatedRowNumbers.push(i + 1);
    }

    for (let i = 0; i < updatedRows.length; i++) {
      chatsSheet.getRange(updatedRowNumbers[i], 1, 1, chatHeaders.length).setValues([updatedRows[i]]);
    }
  }

  return {
    ok: true,
    status: "success",
    threadId: threadId,
    readerType: readerType,
  };
}

function getAdminChatThreads_(data) {
  const statusFilter = String(data.Status || data.status || "").trim().toLowerCase();
  const sheet = getChatThreadsSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return { ok: true, status: "success", threads: [] };
  }

  const headers = values[0].map(function (header) {
    return String(header).trim();
  });
  const idxThreadId = headers.indexOf("ThreadID");
  const idxTaskId = headers.indexOf("TaskID");
  const idxUserPhone = headers.indexOf("UserPhone");
  const idxProviderId = headers.indexOf("ProviderID");
  const idxLastMessage = headers.indexOf("LastMessage");
  const idxLastMessageAt = headers.indexOf("LastMessageAt");
  const idxUnreadUser = headers.indexOf("UnreadUser");
  const idxUnreadProvider = headers.indexOf("UnreadProvider");
  const idxCreatedAt = headers.indexOf("CreatedAt");
  const idxStatus = headers.indexOf("Status");
  const idxClosedBy = headers.indexOf("ClosedBy");
  const idxClosedAt = headers.indexOf("ClosedAt");
  const idxBlockedFlag = headers.indexOf("BlockedFlag");
  const idxBlockedReason = headers.indexOf("BlockedReason");
  const idxLastSenderType = headers.indexOf("LastSenderType");
  const threads = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const rowStatus = idxStatus >= 0 ? String(row[idxStatus] || "").trim() : "";
    if (statusFilter && rowStatus.toLowerCase() !== statusFilter) continue;

    threads.push({
      ThreadID: idxThreadId >= 0 ? row[idxThreadId] : "",
      TaskID: idxTaskId >= 0 ? row[idxTaskId] : "",
      UserPhone: idxUserPhone >= 0 ? row[idxUserPhone] : "",
      ProviderID: idxProviderId >= 0 ? row[idxProviderId] : "",
      LastMessage: idxLastMessage >= 0 ? row[idxLastMessage] : "",
      LastMessageAt: idxLastMessageAt >= 0 ? row[idxLastMessageAt] : "",
      UnreadUser: idxUnreadUser >= 0 ? row[idxUnreadUser] : "",
      UnreadProvider: idxUnreadProvider >= 0 ? row[idxUnreadProvider] : "",
      CreatedAt: idxCreatedAt >= 0 ? row[idxCreatedAt] : "",
      Status: rowStatus,
      ClosedBy: idxClosedBy >= 0 ? row[idxClosedBy] : "",
      ClosedAt: idxClosedAt >= 0 ? row[idxClosedAt] : "",
      BlockedFlag: idxBlockedFlag >= 0 ? row[idxBlockedFlag] : "",
      BlockedReason: idxBlockedReason >= 0 ? row[idxBlockedReason] : "",
      LastSenderType: idxLastSenderType >= 0 ? row[idxLastSenderType] : "",
    });
  }

  threads.sort(function (a, b) {
    const aTime = parseTaskDateMs_(a.LastMessageAt || a.CreatedAt);
    const bTime = parseTaskDateMs_(b.LastMessageAt || b.CreatedAt);
    return bTime - aTime;
  });

  return { ok: true, status: "success", threads: threads };
}

function closeChatThread_(data) {
  const threadId = String(data.ThreadID || data.threadId || "").trim();
  const closedBy = String(data.ClosedBy || data.closedBy || "").trim().toLowerCase();

  if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };
  if (closedBy !== "admin" && closedBy !== "user" && closedBy !== "provider") {
    return { ok: false, status: "error", error: "ClosedBy must be admin, user or provider" };
  }

  const sheet = getChatThreadsSheet_();
  const values = sheet.getDataRange().getValues();
  const headers = values.length ? values[0].map(function (header) {
    return String(header).trim();
  }) : [];
  const idxThreadId = headers.indexOf("ThreadID");
  const idxStatus = headers.indexOf("Status");
  const idxClosedBy = headers.indexOf("ClosedBy");
  const idxClosedAt = headers.indexOf("ClosedAt");
  let rowNumber = 0;
  let row = null;

  for (let i = 1; i < values.length; i++) {
    const currentRow = values[i] || [];
    const rowThreadId = idxThreadId >= 0 ? String(currentRow[idxThreadId] || "").trim() : "";
    if (rowThreadId !== threadId) continue;
    rowNumber = i + 1;
    row = currentRow.slice();
    break;
  }

  if (!rowNumber || !row) {
    return { ok: false, status: "error", error: "Chat thread not found" };
  }

  while (row.length < headers.length) row.push("");

  if (idxStatus >= 0) row[idxStatus] = "closed";
  if (idxClosedBy >= 0) row[idxClosedBy] = closedBy;
  if (idxClosedAt >= 0) {
    row[idxClosedAt] = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");
  }

  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);

  return {
    ok: true,
    status: "success",
    threadId: threadId,
    Status: "closed",
  };
}
