/*************************************************
 * CHAT SHEETS
 *************************************************/
function getChatThreadsSheet_() {
  const headers = [
    "ThreadID",
    "TaskID",
    "UserPhone",
    "ProviderID",
    "ProviderPhone",
    "Category",
    "Area",
    "Status",
    "CreatedAt",
    "UpdatedAt",
    "LastMessageAt",
    "LastMessageBy",
    "UnreadUserCount",
    "UnreadProviderCount",
  ];

  const sheet = getOrCreateSheet(SHEET_CHAT_THREADS, headers);
  ensureSheetHeaders_(sheet, headers);
  return sheet;
}

function getChatMessagesSheet_() {
  const headers = [
    "MessageID",
    "ThreadID",
    "TaskID",
    "SenderType",
    "SenderPhone",
    "SenderName",
    "MessageText",
    "MessageType",
    "CreatedAt",
    "ReadByUser",
    "ReadByProvider",
  ];

  const sheet = getOrCreateSheet(SHEET_CHAT_MESSAGES, headers);
  ensureSheetHeaders_(sheet, headers);
  return sheet;
}

/*************************************************
 * CHAT IDS / TIMESTAMPS
 *************************************************/
function nextChatEntityId_(sheet, prefix) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return prefix + "-0001";

  let maxSeq = 0;
  const re = new RegExp("^" + prefix + "-(\\d+)$", "i");

  for (let i = 1; i < values.length; i++) {
    const id = String(values[i][0] || "").trim();
    const match = id.match(re);
    if (!match) continue;

    const seq = Number(match[1]) || 0;
    if (seq > maxSeq) maxSeq = seq;
  }

  return prefix + "-" + ("0000" + (maxSeq + 1)).slice(-4);
}

function generateThreadId_(sheet) {
  return nextChatEntityId_(sheet, "TH");
}

function generateMessageId_(sheet) {
  return nextChatEntityId_(sheet, "MSG");
}

function getChatTimestamp_() {
  return Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");
}

function getCellValue_(row, idx) {
  return idx !== -1 && row[idx] !== undefined ? row[idx] : "";
}

/*************************************************
 * CHAT HEADER MAPS
 *************************************************/
function getChatThreadHeaderMap_(headers) {
  return {
    threadId: findHeaderIndexByAliases_(headers, ["ThreadID"]),
    taskId: findHeaderIndexByAliases_(headers, ["TaskID"]),
    userPhone: findHeaderIndexByAliases_(headers, ["UserPhone"]),
    providerId: findHeaderIndexByAliases_(headers, ["ProviderID"]),
    providerPhone: findHeaderIndexByAliases_(headers, ["ProviderPhone"]),
    category: findHeaderIndexByAliases_(headers, ["Category"]),
    area: findHeaderIndexByAliases_(headers, ["Area"]),
    status: findHeaderIndexByAliases_(headers, ["Status"]),
    createdAt: findHeaderIndexByAliases_(headers, ["CreatedAt"]),
    updatedAt: findHeaderIndexByAliases_(headers, ["UpdatedAt"]),
    lastMessageAt: findHeaderIndexByAliases_(headers, ["LastMessageAt"]),
    lastMessageBy: findHeaderIndexByAliases_(headers, ["LastMessageBy"]),
    unreadUserCount: findHeaderIndexByAliases_(headers, ["UnreadUserCount"]),
    unreadProviderCount: findHeaderIndexByAliases_(headers, ["UnreadProviderCount"]),
  };
}

function getChatMessageHeaderMap_(headers) {
  return {
    messageId: findHeaderIndexByAliases_(headers, ["MessageID"]),
    threadId: findHeaderIndexByAliases_(headers, ["ThreadID"]),
    taskId: findHeaderIndexByAliases_(headers, ["TaskID"]),
    senderType: findHeaderIndexByAliases_(headers, ["SenderType"]),
    senderPhone: findHeaderIndexByAliases_(headers, ["SenderPhone"]),
    senderName: findHeaderIndexByAliases_(headers, ["SenderName"]),
    messageText: findHeaderIndexByAliases_(headers, ["MessageText"]),
    messageType: findHeaderIndexByAliases_(headers, ["MessageType"]),
    createdAt: findHeaderIndexByAliases_(headers, ["CreatedAt"]),
    readByUser: findHeaderIndexByAliases_(headers, ["ReadByUser"]),
    readByProvider: findHeaderIndexByAliases_(headers, ["ReadByProvider"]),
  };
}

/*************************************************
 * CHAT ROW MAPPERS
 *************************************************/
function mapChatThreadRow_(headers, row) {
  const idx = getChatThreadHeaderMap_(headers);

  return {
    ThreadID: String(getCellValue_(row, idx.threadId) || "").trim(),
    TaskID: String(getCellValue_(row, idx.taskId) || "").trim(),
    UserPhone: normalizePhone10_(getCellValue_(row, idx.userPhone)),
    ProviderID: String(getCellValue_(row, idx.providerId) || "").trim(),
    ProviderPhone: normalizePhone10_(getCellValue_(row, idx.providerPhone)),
    Category: String(getCellValue_(row, idx.category) || "").trim(),
    Area: String(getCellValue_(row, idx.area) || "").trim(),
    Status: String(getCellValue_(row, idx.status) || "").trim(),
    CreatedAt: getCellValue_(row, idx.createdAt),
    UpdatedAt: getCellValue_(row, idx.updatedAt),
    LastMessageAt: getCellValue_(row, idx.lastMessageAt),
    LastMessageBy: String(getCellValue_(row, idx.lastMessageBy) || "").trim(),
    UnreadUserCount: Number(getCellValue_(row, idx.unreadUserCount)) || 0,
    UnreadProviderCount: Number(getCellValue_(row, idx.unreadProviderCount)) || 0,
  };
}

function mapChatMessageRow_(headers, row) {
  const idx = getChatMessageHeaderMap_(headers);

  return {
    MessageID: String(getCellValue_(row, idx.messageId) || "").trim(),
    ThreadID: String(getCellValue_(row, idx.threadId) || "").trim(),
    TaskID: String(getCellValue_(row, idx.taskId) || "").trim(),
    SenderType: String(getCellValue_(row, idx.senderType) || "").trim().toLowerCase(),
    SenderPhone: normalizePhone10_(getCellValue_(row, idx.senderPhone)),
    SenderName: String(getCellValue_(row, idx.senderName) || "").trim(),
    MessageText: String(getCellValue_(row, idx.messageText) || "").trim(),
    MessageType: String(getCellValue_(row, idx.messageType) || "").trim().toLowerCase(),
    CreatedAt: getCellValue_(row, idx.createdAt),
    ReadByUser: String(getCellValue_(row, idx.readByUser) || "").trim().toLowerCase(),
    ReadByProvider: String(getCellValue_(row, idx.readByProvider) || "").trim().toLowerCase(),
  };
}

/*************************************************
 * CHAT THREAD LOOKUPS
 *************************************************/
function getChatThreadStateByThreadId_(threadId) {
  const sheet = getChatThreadsSheet_();
  const values = sheet.getDataRange().getValues();
  const headers = values.length ? values[0] : [];
  const idx = getChatThreadHeaderMap_(headers);

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const rowThreadId = String(getCellValue_(row, idx.threadId) || "").trim();
    if (rowThreadId !== threadId) continue;

    return {
      sheet: sheet,
      headers: headers,
      rowNumber: i + 1,
      row: row,
      thread: mapChatThreadRow_(headers, row),
    };
  }

  return null;
}

function getChatThreadStateByTaskProvider_(taskId, providerId) {
  const sheet = getChatThreadsSheet_();
  const values = sheet.getDataRange().getValues();
  const headers = values.length ? values[0] : [];
  const idx = getChatThreadHeaderMap_(headers);

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const rowTaskId = String(getCellValue_(row, idx.taskId) || "").trim();
    const rowProviderId = String(getCellValue_(row, idx.providerId) || "").trim();
    if (rowTaskId !== taskId || rowProviderId !== providerId) continue;

    return {
      sheet: sheet,
      headers: headers,
      rowNumber: i + 1,
      row: row,
      thread: mapChatThreadRow_(headers, row),
    };
  }

  return null;
}

/*************************************************
 * TASK / PROVIDER / MATCH LOOKUPS
 *************************************************/
function getTaskRecordForChat_(taskId) {
  const state = getAdminTaskSheetState_();
  if (!state || !state.values || state.idxTaskId === -1) return null;

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const rowTaskId =
      state.idxTaskId !== -1 && row[state.idxTaskId] !== undefined
        ? String(row[state.idxTaskId]).trim()
        : "";
    if (rowTaskId !== taskId) continue;

    return {
      TaskID: rowTaskId,
      UserPhone:
        state.idxUserPhone !== -1 ? normalizePhone10_(row[state.idxUserPhone]) : "",
      Category:
        state.idxCategory !== -1 && row[state.idxCategory] !== undefined
          ? String(row[state.idxCategory]).trim()
          : "",
      Area:
        state.idxArea !== -1 && row[state.idxArea] !== undefined
          ? String(row[state.idxArea]).trim()
          : "",
      Status:
        state.idxStatus !== -1 && row[state.idxStatus] !== undefined
          ? String(row[state.idxStatus]).trim()
          : "",
    };
  }

  return null;
}

function getProviderRecordById_(providerId) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_PROVIDERS);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] || [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const headerMap = getProviderHeaderMap_(headers);

  if (!headerMap || headerMap.providerId === -1) return null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const rowProviderId =
      row[headerMap.providerId] !== undefined ? String(row[headerMap.providerId]).trim() : "";
    if (rowProviderId !== providerId) continue;

    const providerName =
      headerMap.providerName !== -1 && row[headerMap.providerName] !== undefined
        ? String(row[headerMap.providerName]).trim()
        : "";
    const phone =
      headerMap.phone !== -1 && row[headerMap.phone] !== undefined
        ? normalizePhone10_(row[headerMap.phone])
        : "";

    return {
      ProviderID: rowProviderId,
      ProviderName: providerName,
      Phone: phone,
    };
  }

  return null;
}

function getTaskProviderMatchRecord_(taskId, providerId) {
  const sheet = getProviderTaskMatchesSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return null;

  const headers = values[0] || [];
  const idxTaskId = findHeaderIndexByAliases_(headers, ["TaskID"]);
  const idxProviderId = findHeaderIndexByAliases_(headers, ["ProviderID"]);
  const idxProviderPhone = findHeaderIndexByAliases_(headers, ["ProviderPhone", "Phone"]);
  const idxProviderName = findHeaderIndexByAliases_(headers, ["ProviderName", "Name"]);
  const idxCategory = findHeaderIndexByAliases_(headers, ["Category"]);
  const idxArea = findHeaderIndexByAliases_(headers, ["Area"]);
  const idxStatus = findHeaderIndexByAliases_(headers, ["Status"]);

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const rowTaskId = idxTaskId !== -1 ? String(row[idxTaskId] || "").trim() : "";
    const rowProviderId = idxProviderId !== -1 ? String(row[idxProviderId] || "").trim() : "";
    if (rowTaskId !== taskId || rowProviderId !== providerId) continue;

    return {
      TaskID: rowTaskId,
      ProviderID: rowProviderId,
      ProviderPhone: idxProviderPhone !== -1 ? normalizePhone10_(row[idxProviderPhone]) : "",
      ProviderName: idxProviderName !== -1 ? String(row[idxProviderName] || "").trim() : "",
      Category: idxCategory !== -1 ? String(row[idxCategory] || "").trim() : "",
      Area: idxArea !== -1 ? String(row[idxArea] || "").trim() : "",
      Status: idxStatus !== -1 ? String(row[idxStatus] || "").trim() : "",
    };
  }

  return null;
}

/*************************************************
 * CHAT ACCESS CONTROL
 *************************************************/
function resolveProviderActor_(data) {
  const providerPhone = normalizePhone10_(
    data.ProviderPhone ||
      data.providerPhone ||
      data.phone ||
      data.requesterPhone ||
      data.loggedInProviderPhone
  );
  const requestedProviderId = String(data.ProviderID || data.providerId || "").trim();

  if (!providerPhone) {
    return {
      ok: false,
      error: "Trusted logged-in provider phone is required for provider context",
    };
  }

  const byPhone = getProviderByPhone_(providerPhone);
  if (!byPhone || !byPhone.ok || !byPhone.provider || !byPhone.provider.ProviderID) {
    return { ok: false, error: "Logged-in provider not found" };
  }

  const resolvedProviderId = String(byPhone.provider.ProviderID || "").trim();
  if (requestedProviderId && requestedProviderId !== resolvedProviderId) {
    return { ok: false, error: "ProviderID does not match logged-in provider context" };
  }

  return {
    ok: true,
    provider: {
      ProviderID: resolvedProviderId,
      ProviderName: String(byPhone.provider.ProviderName || "").trim(),
      Phone: normalizePhone10_(byPhone.provider.Phone),
    },
  };
}

function resolveChatActor_(data) {
  const actorType = String(data.ActorType || data.actorType || "")
    .trim()
    .toLowerCase();

  if (actorType !== "user" && actorType !== "provider") {
    return { ok: false, error: "ActorType must be user or provider" };
  }

  if (actorType === "user") {
    const userPhone = normalizePhone10_(
      data.UserPhone || data.userPhone || data.phone || data.requesterPhone
    );
    if (!userPhone) {
      return { ok: false, error: "UserPhone required for user context" };
    }

    return {
      ok: true,
      actorType: "user",
      userPhone: userPhone,
      senderPhone: userPhone,
      senderName: String(data.SenderName || data.senderName || "User").trim() || "User",
    };
  }

  const providerResult = resolveProviderActor_(data);
  if (!providerResult.ok) return providerResult;

  return {
    ok: true,
    actorType: "provider",
    providerId: providerResult.provider.ProviderID,
    providerPhone: providerResult.provider.Phone,
    senderPhone: providerResult.provider.Phone,
    senderName:
      String(
        data.SenderName ||
          data.senderName ||
          providerResult.provider.ProviderName ||
          "Provider"
      ).trim() || "Provider",
  };
}

function canChatActorAccessThread_(actor, thread) {
  if (!actor || !actor.ok || !thread) return false;

  if (actor.actorType === "user") {
    return normalizePhone10_(thread.UserPhone) === normalizePhone10_(actor.userPhone);
  }

  if (actor.actorType === "provider") {
    const sameProviderId =
      String(thread.ProviderID || "").trim() === String(actor.providerId || "").trim();
    const sameProviderPhone =
      normalizePhone10_(thread.ProviderPhone) === normalizePhone10_(actor.providerPhone);

    return sameProviderId || sameProviderPhone;
  }

  return false;
}

/*************************************************
 * CHAT ACTIONS
 *************************************************/
function chatCreateOrGetThread_(data) {
  const taskId = String(data.TaskID || data.taskId || "").trim();
  if (!taskId) return { ok: false, status: "error", error: "TaskID required" };

  const actor = resolveChatActor_(data);
  if (!actor.ok) return { ok: false, status: "error", error: actor.error };

  const task = getTaskRecordForChat_(taskId);
  if (!task) return { ok: false, status: "error", error: "Task not found" };
  if (!task.UserPhone) return { ok: false, status: "error", error: "Task user phone missing" };

  let providerId = "";
  let providerContext = null;

  if (actor.actorType === "user") {
    providerId = String(data.ProviderID || data.providerId || "").trim();
    if (!providerId) {
      return { ok: false, status: "error", error: "ProviderID required for user flow" };
    }

    providerContext = getProviderRecordById_(providerId);
    if (!providerContext || !providerContext.ProviderID) {
      return { ok: false, status: "error", error: "Provider not found" };
    }

    if (actor.userPhone !== task.UserPhone) {
      return { ok: false, status: "error", error: "Access denied for this task" };
    }
  } else {
    providerId = String(actor.providerId || "").trim();
    if (!providerId) {
      return { ok: false, status: "error", error: "Logged-in provider context missing" };
    }

    providerContext = {
      ProviderID: providerId,
      ProviderName: actor.senderName,
      Phone: actor.providerPhone,
    };
  }

  const match = getTaskProviderMatchRecord_(taskId, providerId);
  if (!match) {
    return { ok: false, status: "error", error: "Provider is not matched to this task" };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    const existing = getChatThreadStateByTaskProvider_(taskId, providerId);
    if (existing) {
      if (!canChatActorAccessThread_(actor, existing.thread)) {
        return { ok: false, status: "error", error: "Access denied" };
      }

      return {
        ok: true,
        status: "success",
        created: false,
        thread: existing.thread,
      };
    }

    const sheet = getChatThreadsSheet_();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] || [];
    const now = getChatTimestamp_();

    const thread = {
      ThreadID: generateThreadId_(sheet),
      TaskID: taskId,
      UserPhone: task.UserPhone,
      ProviderID: providerId,
      ProviderPhone: providerContext.Phone || match.ProviderPhone || "",
      Category: task.Category || match.Category || "",
      Area: task.Area || match.Area || "",
      Status: "active",
      CreatedAt: now,
      UpdatedAt: now,
      LastMessageAt: "",
      LastMessageBy: "",
      UnreadUserCount: 0,
      UnreadProviderCount: 0,
    };

    sheet.appendRow(buildRowFromData_(headers, thread));

    return {
      ok: true,
      status: "success",
      created: true,
      thread: thread,
    };
  } finally {
    lock.releaseLock();
  }
}

function chatGetThreads_(data) {
  const actor = resolveChatActor_(data);
  if (!actor.ok) return { ok: false, status: "error", error: actor.error };

  const taskIdFilter = String(data.TaskID || data.taskId || "").trim();
  const statusFilter = String(data.Status || data.status || "").trim().toLowerCase();

  const sheet = getChatThreadsSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return { ok: true, status: "success", threads: [] };
  }

  const headers = values[0] || [];
  const threads = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const thread = mapChatThreadRow_(headers, row);

    if (taskIdFilter && thread.TaskID !== taskIdFilter) continue;
    if (statusFilter && String(thread.Status || "").toLowerCase() !== statusFilter) continue;
    if (!canChatActorAccessThread_(actor, thread)) continue;

    threads.push(thread);
  }

  threads.sort(function (a, b) {
    const aMs = parseTaskDateMs_(a.LastMessageAt || a.UpdatedAt || a.CreatedAt);
    const bMs = parseTaskDateMs_(b.LastMessageAt || b.UpdatedAt || b.CreatedAt);
    return bMs - aMs;
  });

  return {
    ok: true,
    status: "success",
    threads: threads,
  };
}

function chatGetMessages_(data) {
  const threadId = String(data.ThreadID || data.threadId || "").trim();
  if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };

  const actor = resolveChatActor_(data);
  if (!actor.ok) return { ok: false, status: "error", error: actor.error };

  const threadState = getChatThreadStateByThreadId_(threadId);
  if (!threadState) return { ok: false, status: "error", error: "Thread not found" };
  if (!canChatActorAccessThread_(actor, threadState.thread)) {
    return { ok: false, status: "error", error: "Access denied" };
  }

  const sheet = getChatMessagesSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return {
      ok: true,
      status: "success",
      thread: threadState.thread,
      messages: [],
    };
  }

  const headers = values[0] || [];
  const idx = getChatMessageHeaderMap_(headers);
  const messages = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const rowThreadId = String(getCellValue_(row, idx.threadId) || "").trim();
    if (rowThreadId !== threadId) continue;

    messages.push(mapChatMessageRow_(headers, row));
  }

  messages.sort(function (a, b) {
    return parseTaskDateMs_(a.CreatedAt) - parseTaskDateMs_(b.CreatedAt);
  });

  return {
    ok: true,
    status: "success",
    thread: threadState.thread,
    messages: messages,
  };
}

function chatSendMessage_(data) {
  const threadId = String(data.ThreadID || data.threadId || "").trim();
  const messageText = String(data.MessageText || data.messageText || "").trim();
  const messageType = String(data.MessageType || data.messageType || "text").trim().toLowerCase();

  if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };
  if (!messageText) return { ok: false, status: "error", error: "MessageText required" };
  if (messageText.length > 2000) {
    return { ok: false, status: "error", error: "MessageText too long" };
  }
  if (messageType !== "text") {
    return { ok: false, status: "error", error: "Only text messages are supported" };
  }

  const actor = resolveChatActor_(data);
  if (!actor.ok) return { ok: false, status: "error", error: actor.error };

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    const threadState = getChatThreadStateByThreadId_(threadId);
    if (!threadState) return { ok: false, status: "error", error: "Thread not found" };
    if (!canChatActorAccessThread_(actor, threadState.thread)) {
      return { ok: false, status: "error", error: "Access denied" };
    }
    if (String(threadState.thread.Status || "").toLowerCase() === "closed") {
      return { ok: false, status: "error", error: "Thread is closed" };
    }

    const now = getChatTimestamp_();
    const messageSheet = getChatMessagesSheet_();
    const messageHeaders =
      messageSheet.getRange(1, 1, 1, messageSheet.getLastColumn()).getValues()[0] || [];

    const message = {
      MessageID: generateMessageId_(messageSheet),
      ThreadID: threadState.thread.ThreadID,
      TaskID: threadState.thread.TaskID,
      SenderType: actor.actorType,
      SenderPhone:
        actor.actorType === "user"
          ? threadState.thread.UserPhone
          : actor.providerPhone || threadState.thread.ProviderPhone,
      SenderName: actor.senderName,
      MessageText: messageText,
      MessageType: "text",
      CreatedAt: now,
      ReadByUser: actor.actorType === "user" ? "yes" : "no",
      ReadByProvider: actor.actorType === "provider" ? "yes" : "no",
    };

    messageSheet.appendRow(buildRowFromData_(messageHeaders, message));

    const threadUpdates = {
      UpdatedAt: now,
      LastMessageAt: now,
      LastMessageBy: actor.actorType,
      UnreadUserCount:
        actor.actorType === "provider"
          ? (Number(threadState.thread.UnreadUserCount) || 0) + 1
          : Number(threadState.thread.UnreadUserCount) || 0,
      UnreadProviderCount:
        actor.actorType === "user"
          ? (Number(threadState.thread.UnreadProviderCount) || 0) + 1
          : Number(threadState.thread.UnreadProviderCount) || 0,
    };

    updateRowFromData_(threadState.sheet, threadState.rowNumber, threadUpdates);

    const updatedThreadState = getChatThreadStateByThreadId_(threadId);

    return {
      ok: true,
      status: "success",
      thread: updatedThreadState ? updatedThreadState.thread : threadState.thread,
      message: message,
    };
  } finally {
    lock.releaseLock();
  }
}

function chatMarkRead_(data) {
  const threadId = String(data.ThreadID || data.threadId || "").trim();
  if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };

  const actor = resolveChatActor_(data);
  if (!actor.ok) return { ok: false, status: "error", error: actor.error };

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    const threadState = getChatThreadStateByThreadId_(threadId);
    if (!threadState) return { ok: false, status: "error", error: "Thread not found" };
    if (!canChatActorAccessThread_(actor, threadState.thread)) {
      return { ok: false, status: "error", error: "Access denied" };
    }

    const now = getChatTimestamp_();
    const threadUpdates =
      actor.actorType === "user"
        ? { UpdatedAt: now, UnreadUserCount: 0 }
        : { UpdatedAt: now, UnreadProviderCount: 0 };

    updateRowFromData_(threadState.sheet, threadState.rowNumber, threadUpdates);

    const messageSheet = getChatMessagesSheet_();
    const values = messageSheet.getDataRange().getValues();
    let updatedCount = 0;

    if (values.length > 1) {
      const headers = values[0] || [];
      const idx = getChatMessageHeaderMap_(headers);

      for (let i = 1; i < values.length; i++) {
        const row = values[i] || [];
        const rowThreadId = String(getCellValue_(row, idx.threadId) || "").trim();
        if (rowThreadId !== threadId) continue;

        const senderType = String(getCellValue_(row, idx.senderType) || "").trim().toLowerCase();

        if (actor.actorType === "user") {
          if (senderType === "user") continue;
          const readByUser = String(getCellValue_(row, idx.readByUser) || "").trim().toLowerCase();
          if (readByUser !== "yes" && idx.readByUser !== -1) {
            messageSheet.getRange(i + 1, idx.readByUser + 1).setValue("yes");
            updatedCount += 1;
          }
        } else {
          if (senderType === "provider") continue;
          const readByProvider = String(getCellValue_(row, idx.readByProvider) || "").trim().toLowerCase();
          if (readByProvider !== "yes" && idx.readByProvider !== -1) {
            messageSheet.getRange(i + 1, idx.readByProvider + 1).setValue("yes");
            updatedCount += 1;
          }
        }
      }
    }

    const updatedThreadState = getChatThreadStateByThreadId_(threadId);

    return {
      ok: true,
      status: "success",
      thread: updatedThreadState ? updatedThreadState.thread : threadState.thread,
      markedCount: updatedCount,
    };
  } finally {
    lock.releaseLock();
  }
}
