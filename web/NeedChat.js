/*************************************************
 * NEED CHAT SHEETS
 *************************************************/
const NEED_CHAT_THREAD_HEADERS_ = [
  "ThreadID",
  "NeedID",
  "PosterPhone",
  "ResponderPhone",
  "Status",
  "CreatedAt",
  "UpdatedAt",
  "LastMessageAt",
  "LastMessageBy",
  "UnreadPosterCount",
  "UnreadResponderCount",
];

const NEED_CHAT_MESSAGE_HEADERS_ = [
  "MessageID",
  "ThreadID",
  "NeedID",
  "SenderRole",
  "SenderPhone",
  "SenderName",
  "MessageText",
  "CreatedAt",
  "ReadByPoster",
  "ReadByResponder",
];

function getNeedChatThreadsSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(SHEET_NEED_CHAT_THREADS);
  if (!sh) {
    try {
      sh = ss.insertSheet(SHEET_NEED_CHAT_THREADS);
    } catch (err) {
      sh = ss.getSheetByName(SHEET_NEED_CHAT_THREADS);
      if (!sh) throw err;
    }
  }
  ensureSheetHeaders_(sh, NEED_CHAT_THREAD_HEADERS_);
  return sh;
}

function getNeedChatMessagesSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(SHEET_NEED_CHAT_MESSAGES);
  if (!sh) {
    try {
      sh = ss.insertSheet(SHEET_NEED_CHAT_MESSAGES);
    } catch (err) {
      sh = ss.getSheetByName(SHEET_NEED_CHAT_MESSAGES);
      if (!sh) throw err;
    }
  }
  ensureSheetHeaders_(sh, NEED_CHAT_MESSAGE_HEADERS_);
  return sh;
}

/*************************************************
 * NEED CHAT IDS / TIMESTAMPS
 *************************************************/
function nextNeedChatEntityId_(sheet, prefix) {
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return prefix + "-0001";

  var maxSeq = 0;
  var re = new RegExp("^" + prefix + "-(\\d+)$", "i");

  for (var i = 1; i < values.length; i++) {
    var id = String(values[i][0] || "").trim();
    var match = id.match(re);
    if (!match) continue;

    var seq = Number(match[1]) || 0;
    if (seq > maxSeq) maxSeq = seq;
  }

  return prefix + "-" + ("0000" + (maxSeq + 1)).slice(-4);
}

function generateNeedChatThreadId_(sheet) {
  return nextNeedChatEntityId_(sheet, "NTH");
}

function generateNeedChatMessageId_(sheet) {
  return nextNeedChatEntityId_(sheet, "NMSG");
}

function getNeedChatTimestamp_() {
  return typeof getNeedTimestamp_ === "function"
    ? getNeedTimestamp_()
    : Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");
}

function parseNeedChatDateMs_(value) {
  if (typeof parseNeedCreatedAtMs_ === "function") {
    return parseNeedCreatedAtMs_(value);
  }

  if (!value && value !== 0) return 0;
  if (Object.prototype.toString.call(value) === "[object Date]") {
    var dateMs = value.getTime();
    return isNaN(dateMs) ? 0 : dateMs;
  }

  var raw = String(value || "").trim();
  if (!raw) return 0;

  var match = raw.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/
  );
  if (!match) return 0;

  var parsed = new Date(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1]),
    Number(match[4] || 0),
    Number(match[5] || 0),
    Number(match[6] || 0)
  );
  var parsedMs = parsed.getTime();
  return isNaN(parsedMs) ? 0 : parsedMs;
}

function getNeedChatCellValue_(row, idx) {
  return idx !== -1 && row[idx] !== undefined ? row[idx] : "";
}

/*************************************************
 * NEED CHAT HEADER MAPS
 *************************************************/
function getNeedChatThreadHeaderMap_(headers) {
  return {
    threadId: findHeaderIndexByAliases_(headers, ["ThreadID"]),
    needId: findHeaderIndexByAliases_(headers, ["NeedID"]),
    posterPhone: findHeaderIndexByAliases_(headers, ["PosterPhone"]),
    responderPhone: findHeaderIndexByAliases_(headers, ["ResponderPhone"]),
    status: findHeaderIndexByAliases_(headers, ["Status"]),
    createdAt: findHeaderIndexByAliases_(headers, ["CreatedAt"]),
    updatedAt: findHeaderIndexByAliases_(headers, ["UpdatedAt"]),
    lastMessageAt: findHeaderIndexByAliases_(headers, ["LastMessageAt"]),
    lastMessageBy: findHeaderIndexByAliases_(headers, ["LastMessageBy"]),
    unreadPosterCount: findHeaderIndexByAliases_(headers, ["UnreadPosterCount"]),
    unreadResponderCount: findHeaderIndexByAliases_(headers, ["UnreadResponderCount"]),
  };
}

function getNeedChatMessageHeaderMap_(headers) {
  return {
    messageId: findHeaderIndexByAliases_(headers, ["MessageID"]),
    threadId: findHeaderIndexByAliases_(headers, ["ThreadID"]),
    needId: findHeaderIndexByAliases_(headers, ["NeedID"]),
    senderRole: findHeaderIndexByAliases_(headers, ["SenderRole"]),
    senderPhone: findHeaderIndexByAliases_(headers, ["SenderPhone"]),
    senderName: findHeaderIndexByAliases_(headers, ["SenderName"]),
    messageText: findHeaderIndexByAliases_(headers, ["MessageText"]),
    createdAt: findHeaderIndexByAliases_(headers, ["CreatedAt"]),
    readByPoster: findHeaderIndexByAliases_(headers, ["ReadByPoster"]),
    readByResponder: findHeaderIndexByAliases_(headers, ["ReadByResponder"]),
  };
}

/*************************************************
 * NEED CHAT ROW MAPPERS
 *************************************************/
function mapNeedChatThreadRow_(headers, row) {
  var idx = getNeedChatThreadHeaderMap_(headers);

  return {
    ThreadID: String(getNeedChatCellValue_(row, idx.threadId) || "").trim(),
    NeedID: String(getNeedChatCellValue_(row, idx.needId) || "").trim(),
    PosterPhone: normalizePhone10_(getNeedChatCellValue_(row, idx.posterPhone)),
    ResponderPhone: normalizePhone10_(getNeedChatCellValue_(row, idx.responderPhone)),
    Status: String(getNeedChatCellValue_(row, idx.status) || "").trim(),
    CreatedAt: String(getNeedChatCellValue_(row, idx.createdAt) || "").trim(),
    UpdatedAt: String(getNeedChatCellValue_(row, idx.updatedAt) || "").trim(),
    LastMessageAt: String(getNeedChatCellValue_(row, idx.lastMessageAt) || "").trim(),
    LastMessageBy: String(getNeedChatCellValue_(row, idx.lastMessageBy) || "").trim(),
    UnreadPosterCount: Number(getNeedChatCellValue_(row, idx.unreadPosterCount)) || 0,
    UnreadResponderCount: Number(getNeedChatCellValue_(row, idx.unreadResponderCount)) || 0,
  };
}

function mapNeedChatMessageRow_(headers, row) {
  var idx = getNeedChatMessageHeaderMap_(headers);

  return {
    MessageID: String(getNeedChatCellValue_(row, idx.messageId) || "").trim(),
    ThreadID: String(getNeedChatCellValue_(row, idx.threadId) || "").trim(),
    NeedID: String(getNeedChatCellValue_(row, idx.needId) || "").trim(),
    SenderRole: String(getNeedChatCellValue_(row, idx.senderRole) || "")
      .trim()
      .toLowerCase(),
    SenderPhone: normalizePhone10_(getNeedChatCellValue_(row, idx.senderPhone)),
    SenderName: String(getNeedChatCellValue_(row, idx.senderName) || "").trim(),
    MessageText: String(getNeedChatCellValue_(row, idx.messageText) || "").trim(),
    CreatedAt: String(getNeedChatCellValue_(row, idx.createdAt) || "").trim(),
    ReadByPoster: String(getNeedChatCellValue_(row, idx.readByPoster) || "")
      .trim()
      .toLowerCase(),
    ReadByResponder: String(getNeedChatCellValue_(row, idx.readByResponder) || "")
      .trim()
      .toLowerCase(),
  };
}

/*************************************************
 * NEED CHAT LOOKUPS
 *************************************************/
function getNeedChatThreadStateByThreadId_(threadId) {
  var sheet = getNeedChatThreadsSheet_();
  var values = sheet.getDataRange().getValues();
  var headers = values.length ? values[0] : [];
  var idx = getNeedChatThreadHeaderMap_(headers);

  for (var i = 1; i < values.length; i++) {
    var row = values[i] || [];
    var rowThreadId = String(getNeedChatCellValue_(row, idx.threadId) || "").trim();
    if (rowThreadId !== threadId) continue;

    return {
      sheet: sheet,
      headers: headers,
      rowNumber: i + 1,
      row: row,
      thread: mapNeedChatThreadRow_(headers, row),
    };
  }

  return null;
}

function getNeedChatThreadStateByNeedResponder_(needId, responderPhone) {
  var sheet = getNeedChatThreadsSheet_();
  var values = sheet.getDataRange().getValues();
  var headers = values.length ? values[0] : [];
  var idx = getNeedChatThreadHeaderMap_(headers);
  var safeResponderPhone = normalizePhone10_(responderPhone);

  for (var i = 1; i < values.length; i++) {
    var row = values[i] || [];
    var rowNeedId = String(getNeedChatCellValue_(row, idx.needId) || "").trim();
    var rowResponderPhone = normalizePhone10_(getNeedChatCellValue_(row, idx.responderPhone));
    if (rowNeedId !== needId || rowResponderPhone !== safeResponderPhone) continue;

    return {
      sheet: sheet,
      headers: headers,
      rowNumber: i + 1,
      row: row,
      thread: mapNeedChatThreadRow_(headers, row),
    };
  }

  return null;
}

function getNeedForChat_(needId) {
  var context = getNeedRowContext_({ NeedID: needId });
  if (!context.ok) return context;

  return {
    ok: true,
    need: context.need,
    rowNumber: context.rowNumber,
    state: context.state,
  };
}

/*************************************************
 * NEED CHAT ACCESS CONTROL
 *************************************************/
function resolveNeedChatActor_(data) {
  var actorRole = String(data.ActorRole || data.actorRole || data.Role || data.role || "")
    .trim()
    .toLowerCase();

  if (actorRole !== "poster" && actorRole !== "responder") {
    return { ok: false, status: "error", error: "ActorRole must be poster or responder" };
  }

  var phoneRaw =
    actorRole === "poster"
      ? data.PosterPhone || data.posterPhone || data.UserPhone || data.userPhone || data.phone
      : data.ResponderPhone ||
        data.responderPhone ||
        data.UserPhone ||
        data.userPhone ||
        data.phone;
  var actorPhone = normalizePhone10_(phoneRaw);
  if (!actorPhone) {
    return {
      ok: false,
      status: "error",
      error: actorRole === "poster" ? "PosterPhone required" : "ResponderPhone required",
    };
  }

  return {
    ok: true,
    actorRole: actorRole,
    actorPhone: actorPhone,
    senderName:
      String(
        data.SenderName ||
          data.senderName ||
          (actorRole === "poster" ? "Poster" : "Responder")
      ).trim() || (actorRole === "poster" ? "Poster" : "Responder"),
  };
}

function canNeedChatActorAccessThread_(actor, thread) {
  if (!actor || !actor.ok || !thread) return false;

  if (actor.actorRole === "poster") {
    return normalizePhone10_(thread.PosterPhone) === normalizePhone10_(actor.actorPhone);
  }

  if (actor.actorRole === "responder") {
    return normalizePhone10_(thread.ResponderPhone) === normalizePhone10_(actor.actorPhone);
  }

  return false;
}

function getNeedChatPosterSenderName_(need) {
  if (!need) return "Poster";
  if (need.IsAnonymous) return "Anonymous";
  return String(need.DisplayName || need.PosterLabel || "Poster").trim() || "Poster";
}

/*************************************************
 * NEED CHAT ACTIONS
 *************************************************/
function needChatCreateOrGetThread_(data) {
  var needId = String(data.NeedID || data.needId || "").trim();
  var responderPhone = normalizePhone10_(
    data.ResponderPhone || data.responderPhone || data.UserPhone || data.userPhone || data.phone
  );
  var requestedPosterPhone = normalizePhone10_(data.PosterPhone || data.posterPhone || "");

  if (!needId) return { ok: false, status: "error", error: "NeedID required" };
  if (!responderPhone) {
    return { ok: false, status: "error", error: "ResponderPhone required" };
  }

  var needResult = getNeedForChat_(needId);
  if (!needResult.ok) return needResult;

  var need = needResult.need;
  var posterPhone = normalizePhone10_(need.UserPhone);
  if (!posterPhone) {
    return { ok: false, status: "error", error: "Need poster phone missing" };
  }
  if (requestedPosterPhone && requestedPosterPhone !== posterPhone) {
    return { ok: false, status: "error", error: "PosterPhone does not match need owner" };
  }
  if (responderPhone === posterPhone) {
    return { ok: false, status: "error", error: "Poster cannot respond to own need" };
  }
  if (String(need.CurrentStatus || "").trim().toLowerCase() !== "open") {
    return { ok: false, status: "error", error: "Need is not open for responses" };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    var existing = getNeedChatThreadStateByNeedResponder_(needId, responderPhone);
    if (existing) {
      return {
        ok: true,
        status: "success",
        created: false,
        thread: existing.thread,
      };
    }

    var sheet = getNeedChatThreadsSheet_();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] || [];
    var now = getNeedChatTimestamp_();
    var thread = {
      ThreadID: generateNeedChatThreadId_(sheet),
      NeedID: needId,
      PosterPhone: posterPhone,
      ResponderPhone: responderPhone,
      Status: "active",
      CreatedAt: now,
      UpdatedAt: now,
      LastMessageAt: "",
      LastMessageBy: "",
      UnreadPosterCount: 0,
      UnreadResponderCount: 0,
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

function needChatGetMessages_(data) {
  var threadId = String(data.ThreadID || data.threadId || "").trim();
  if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };

  var actor = resolveNeedChatActor_(data);
  if (!actor.ok) return actor;

  var threadState = getNeedChatThreadStateByThreadId_(threadId);
  if (!threadState) return { ok: false, status: "error", error: "Thread not found" };
  if (!canNeedChatActorAccessThread_(actor, threadState.thread)) {
    return { ok: false, status: "error", error: "Access denied" };
  }

  var messageSheet = getNeedChatMessagesSheet_();
  var values = messageSheet.getDataRange().getValues();
  var messages = [];

  if (values.length > 1) {
    var headers = values[0] || [];
    var idx = getNeedChatMessageHeaderMap_(headers);

    for (var i = 1; i < values.length; i++) {
      var row = values[i] || [];
      var rowThreadId = String(getNeedChatCellValue_(row, idx.threadId) || "").trim();
      if (rowThreadId !== threadId) continue;
      messages.push(mapNeedChatMessageRow_(headers, row));
    }
  }

  messages.sort(function (a, b) {
    return parseNeedChatDateMs_(a.CreatedAt) - parseNeedChatDateMs_(b.CreatedAt);
  });

  return {
    ok: true,
    status: "success",
    thread: threadState.thread,
    messages: messages,
  };
}

function needChatGetThreadsForNeed_(data) {
  var needId = String(data.NeedID || data.needId || "").trim();
  var posterPhone = normalizePhone10_(
    data.PosterPhone || data.posterPhone || data.UserPhone || data.userPhone || data.phone
  );

  if (!needId) return { ok: false, status: "error", error: "NeedID required" };
  if (!posterPhone) return { ok: false, status: "error", error: "PosterPhone required" };

  var needResult = getNeedForChat_(needId);
  if (!needResult.ok) return needResult;

  if (normalizePhone10_(needResult.need.UserPhone) !== posterPhone) {
    return { ok: false, status: "error", error: "Need ownership mismatch" };
  }

  var sheet = getNeedChatThreadsSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return { ok: true, status: "success", count: 0, threads: [] };
  }

  var headers = values[0] || [];
  var threads = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i] || [];
    var thread = mapNeedChatThreadRow_(headers, row);
    if (!thread.ThreadID) continue;
    if (String(thread.NeedID || "").trim() !== needId) continue;
    if (normalizePhone10_(thread.PosterPhone) !== posterPhone) continue;
    threads.push({
      ThreadID: thread.ThreadID,
      NeedID: thread.NeedID,
      ResponderPhone: thread.ResponderPhone,
      Status: thread.Status,
      CreatedAt: thread.CreatedAt,
      UpdatedAt: thread.UpdatedAt,
      LastMessageAt: thread.LastMessageAt,
      LastMessageBy: thread.LastMessageBy,
      UnreadPosterCount: Number(thread.UnreadPosterCount) || 0,
    });
  }

  threads.sort(function (a, b) {
    var aMs =
      parseNeedChatDateMs_(a.LastMessageAt) ||
      parseNeedChatDateMs_(a.UpdatedAt) ||
      parseNeedChatDateMs_(a.CreatedAt);
    var bMs =
      parseNeedChatDateMs_(b.LastMessageAt) ||
      parseNeedChatDateMs_(b.UpdatedAt) ||
      parseNeedChatDateMs_(b.CreatedAt);
    return bMs - aMs;
  });

  return {
    ok: true,
    status: "success",
    count: threads.length,
    threads: threads,
  };
}

function needChatSendMessage_(data) {
  var threadId = String(data.ThreadID || data.threadId || "").trim();
  var messageText = String(data.MessageText || data.messageText || "").trim();

  if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };
  if (!messageText) return { ok: false, status: "error", error: "MessageText required" };
  if (messageText.length > 2000) {
    return { ok: false, status: "error", error: "MessageText too long" };
  }

  var actor = resolveNeedChatActor_(data);
  if (!actor.ok) return actor;

  var lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    var threadState = getNeedChatThreadStateByThreadId_(threadId);
    if (!threadState) return { ok: false, status: "error", error: "Thread not found" };
    if (!canNeedChatActorAccessThread_(actor, threadState.thread)) {
      return { ok: false, status: "error", error: "Access denied" };
    }
    if (String(threadState.thread.Status || "").trim().toLowerCase() === "closed") {
      return { ok: false, status: "error", error: "Thread is closed" };
    }

    var needResult = getNeedForChat_(threadState.thread.NeedID);
    if (!needResult.ok) return needResult;

    var need = needResult.need;
    var now = getNeedChatTimestamp_();
    var messageSheet = getNeedChatMessagesSheet_();
    var messageHeaders =
      messageSheet.getRange(1, 1, 1, messageSheet.getLastColumn()).getValues()[0] || [];
    var senderName =
      actor.actorRole === "poster" ? getNeedChatPosterSenderName_(need) : actor.senderName;
    var message = {
      MessageID: generateNeedChatMessageId_(messageSheet),
      ThreadID: threadState.thread.ThreadID,
      NeedID: threadState.thread.NeedID,
      SenderRole: actor.actorRole,
      SenderPhone: actor.actorPhone,
      SenderName: senderName,
      MessageText: messageText,
      CreatedAt: now,
      ReadByPoster: actor.actorRole === "poster" ? "yes" : "no",
      ReadByResponder: actor.actorRole === "responder" ? "yes" : "no",
    };

    messageSheet.appendRow(buildRowFromData_(messageHeaders, message));

    var threadUpdates = {
      UpdatedAt: now,
      LastMessageAt: now,
      LastMessageBy: actor.actorRole,
      UnreadPosterCount:
        actor.actorRole === "responder"
          ? (Number(threadState.thread.UnreadPosterCount) || 0) + 1
          : Number(threadState.thread.UnreadPosterCount) || 0,
      UnreadResponderCount:
        actor.actorRole === "poster"
          ? (Number(threadState.thread.UnreadResponderCount) || 0) + 1
          : Number(threadState.thread.UnreadResponderCount) || 0,
    };

    updateRowFromData_(threadState.sheet, threadState.rowNumber, threadUpdates);

    var updatedThreadState = getNeedChatThreadStateByThreadId_(threadId);
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

function needChatMarkRead_(data) {
  var threadId = String(data.ThreadID || data.threadId || "").trim();
  if (!threadId) return { ok: false, status: "error", error: "ThreadID required" };

  var actor = resolveNeedChatActor_(data);
  if (!actor.ok) return actor;

  var lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    var threadState = getNeedChatThreadStateByThreadId_(threadId);
    if (!threadState) return { ok: false, status: "error", error: "Thread not found" };
    if (!canNeedChatActorAccessThread_(actor, threadState.thread)) {
      return { ok: false, status: "error", error: "Access denied" };
    }

    var now = getNeedChatTimestamp_();
    var threadUpdates =
      actor.actorRole === "poster"
        ? { UpdatedAt: now, UnreadPosterCount: 0 }
        : { UpdatedAt: now, UnreadResponderCount: 0 };
    updateRowFromData_(threadState.sheet, threadState.rowNumber, threadUpdates);

    var messageSheet = getNeedChatMessagesSheet_();
    var values = messageSheet.getDataRange().getValues();
    var updatedCount = 0;

    if (values.length > 1) {
      var headers = values[0] || [];
      var idx = getNeedChatMessageHeaderMap_(headers);

      for (var i = 1; i < values.length; i++) {
        var row = values[i] || [];
        var rowThreadId = String(getNeedChatCellValue_(row, idx.threadId) || "").trim();
        if (rowThreadId !== threadId) continue;

        var senderRole = String(getNeedChatCellValue_(row, idx.senderRole) || "")
          .trim()
          .toLowerCase();

        if (actor.actorRole === "poster") {
          if (senderRole === "poster") continue;
          var readByPoster = String(getNeedChatCellValue_(row, idx.readByPoster) || "")
            .trim()
            .toLowerCase();
          if (readByPoster !== "yes" && idx.readByPoster !== -1) {
            messageSheet.getRange(i + 1, idx.readByPoster + 1).setValue("yes");
            updatedCount += 1;
          }
        } else {
          if (senderRole === "responder") continue;
          var readByResponder = String(getNeedChatCellValue_(row, idx.readByResponder) || "")
            .trim()
            .toLowerCase();
          if (readByResponder !== "yes" && idx.readByResponder !== -1) {
            messageSheet.getRange(i + 1, idx.readByResponder + 1).setValue("yes");
            updatedCount += 1;
          }
        }
      }
    }

    var updatedThreadState = getNeedChatThreadStateByThreadId_(threadId);
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
