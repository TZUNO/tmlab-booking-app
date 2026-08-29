/**
 * 東明研 TMLab 預約登記 — Google Apps Script
 *
 * ★ 若瀏覽器開啟 Web App 網址出現「Script function not found: doGet」：
 *   1. 確認本檔已「儲存」，且專案裡有 function doGet（下方有）。
 *   2. 部署 → 管理部署作業 → 鉛筆圖示「編輯」→ 版本選「新版本」→ 部署。
 *
 * 建議：從試算表「擴充功能」→「Apps Script」建立腳本（綁定試算表），
 *       並將 SPREADSHEET_ID 設為 null，較不易權限錯誤。
 *
 * 前端 POST JSON：
 * - 新增：bookingId、timestamp、姓名、日期、時段、討論內容、備註、durationMinutes（分鐘，寫入 H 欄）
 * - 刪除：{ "action":"delete", "bookingId", "timestamp", "姓名", "日期", "時段" }
 */

/**
 * 綁定腳本：設為 null，會用 SpreadsheetApp.getActiveSpreadsheet()
 * 獨立腳本：設為試算表 ID（網址 /d/ 與 /edit 之間）
 */
var SPREADSHEET_ID = "1MZdOExiJqcB9NT2auEtGQSgTKNJq-44-zk01yRcN61o";

var SHEET_NAME = "預約紀錄";

/** 老師額外開放時段 JSON，存在 A1（前端以 GAS getState／saveTeacherPatches 同步） */
var SHEET_TEACHER_PATCHES = "老師開放時段";

var SHEET_HEADERS = [
  "timestamp",
  "姓名",
  "日期",
  "時段",
  "討論內容",
  "備註",
  "預約ID",
  "預計耗時(分鐘)",
];

function getSpreadsheet_() {
  if (SPREADSHEET_ID && String(SPREADSHEET_ID).trim() !== "") {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** 分頁名稱允許與試算表上完全一致（避免尾端空白導致讀不到列） */
function getSheetByNameTrim_(ss, name) {
  var exact = ss.getSheetByName(name);
  if (exact) return exact;
  var target = String(name).trim();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (String(sheets[i].getName()).trim() === target) return sheets[i];
  }
  return null;
}

function cellToIsoOrString_(v) {
  if (v instanceof Date) return v.toISOString();
  return v != null ? String(v) : "";
}

/** C 欄若為試算表 Date，轉成 yyyy-MM-dd 供前端比對 */
function cellDateYmd_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return v != null ? String(v).trim() : "";
}

/**
 * 瀏覽器直接開 Web App 網址 = GET，必須有 doGet，否則會報錯。
 */
function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({
      ok: true,
      message: "TMLab booking GAS OK (doGet)",
      hint: "實際寫入試算表請用 POST JSON（前端已設定）",
    })
  ).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut_({ ok: false, error: "empty body" });
    }

    var data = JSON.parse(e.postData.contents);

    if (data && data.action === "getState") {
      return jsonOut_({
        ok: true,
        bookings: listBookings_(),
        teacherPatches: readTeacherPatchesJson_(),
      });
    }

    if (data && data.action === "saveTeacherPatches") {
      writeTeacherPatchesJson_(data.teacherPatches || []);
      return jsonOut_({ ok: true });
    }

    if (data && data.action === "delete") {
      deleteBookingRow_(data);
      return jsonOut_({ ok: true });
    }
    appendBookingRow_(data);

    return jsonOut_({ ok: true });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

/**
 * 讀取「預約紀錄」第 2 列起，組成前端 BookingRecord 陣列（H 欄為預計耗時分鐘，缺則 30）
 */
function listBookings_() {
  var ss = getSpreadsheet_();
  var sheet = getSheetByNameTrim_(ss, SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }
  var lastRow = sheet.getLastRow();
  /** 自第 2 列起的資料列數；用 lastRow 會多讀一列，資料列滿版時還會讓 getRange 拋錯 */
  var numRows = lastRow - 1;
  if (numRows < 1) {
    return [];
  }
  var numCols = Math.max(sheet.getLastColumn(), 8);
  var values = sheet.getRange(2, 1, numRows, numCols).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (!row) continue;
    var topicsStr = row[4] != null ? String(row[4]) : "";
    var topicParts = topicsStr
      ? topicsStr.split("、").map(function (t) {
          return String(t).trim();
        })
      : [];
    var idCell = row[6] != null ? String(row[6]).trim() : "";
    var durParsed = parseInt(String(row[7] != null ? row[7] : ""), 10);
    var duration = durParsed > 0 && isFinite(durParsed) ? durParsed : 30;
    out.push({
      id: idCell || "sheet-row-" + (i + 2),
      timestamp: cellToIsoOrString_(row[0]),
      name: row[1] != null ? String(row[1]) : "",
      date: cellDateYmd_(row[2]),
      slot: row[3] != null ? String(row[3]) : "",
      duration: duration,
      topics: topicParts,
      note: row[5] != null ? String(row[5]) : "",
    });
  }
  return out;
}

function readTeacherPatchesJson_() {
  var ss = getSpreadsheet_();
  var sheet = getSheetByNameTrim_(ss, SHEET_TEACHER_PATCHES);
  if (!sheet) {
    return [];
  }
  var raw = sheet.getRange(1, 1).getValue();
  if (raw == null || String(raw).trim() === "") {
    return [];
  }
  try {
    var parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function writeTeacherPatchesJson_(arr) {
  var ss = getSpreadsheet_();
  var sheet = getSheetByNameTrim_(ss, SHEET_TEACHER_PATCHES);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_TEACHER_PATCHES);
  }
  sheet.getRange(1, 1).setValue(JSON.stringify(arr));
}

function appendBookingRow_(data) {
  var ss = getSpreadsheet_();
  var sheet = getSheetByNameTrim_(ss, SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(SHEET_HEADERS);
  } else {
    ensureBookingSheetHeaders_(sheet);
  }

  var ts = data.timestamp || new Date().toISOString();
  var name = data["姓名"] || "";
  var date = data["日期"] || "";
  var slot = data["時段"] || "";
  var topics = data["討論內容"] || "";
  var note = data["備註"] || "";
  var bookingId = data.bookingId != null ? String(data.bookingId) : "";
  var durParsed = parseInt(
    String(data.durationMinutes != null ? data.durationMinutes : data["預計耗時"] || ""),
    10
  );
  var durationMin = durParsed > 0 && isFinite(durParsed) ? durParsed : 30;

  sheet.appendRow([ts, name, date, slot, topics, note, bookingId, durationMin]);
}

/**
 * 舊表欄位不足時，補上 G1「預約ID」、H1「預計耗時(分鐘)」（不動既有資料列）。
 */
function ensureBookingSheetHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 7) {
    sheet.getRange(1, 7).setValue("預約ID");
  } else if (String(sheet.getRange(1, 7).getValue() || "").trim() === "") {
    sheet.getRange(1, 7).setValue("預約ID");
  }
  if (lastCol < 8) {
    sheet.getRange(1, 8).setValue("預計耗時(分鐘)");
  } else if (String(sheet.getRange(1, 8).getValue() || "").trim() === "") {
    sheet.getRange(1, 8).setValue("預計耗時(分鐘)");
  }
}

/**
 * 優先以 G 欄預約ID 對齊；舊列無 ID 時以 timestamp+姓名+日期+時段 比對（字串 trim）。
 * 由最後一列往上刪，只刪第一筆命中。
 */
function deleteBookingRow_(data) {
  var bookingId = data.bookingId != null ? String(data.bookingId).trim() : "";
  var ts = data.timestamp != null ? String(data.timestamp).trim() : "";
  var name = data["姓名"] != null ? String(data["姓名"]).trim() : "";
  var date = data["日期"] != null ? String(data["日期"]).trim() : "";
  var slot = data["時段"] != null ? String(data["時段"]).trim() : "";

  var ss = getSpreadsheet_();
  /** 與 listBookings_ 一致，避免分頁名稱尾端空白時刪不到列 */
  var sheet = getSheetByNameTrim_(ss, SHEET_NAME);
  if (!sheet) {
    return;
  }

  var numRows = sheet.getLastRow();
  if (numRows < 2) {
    return;
  }

  var numCols = Math.max(sheet.getLastColumn(), 8);
  var values = sheet.getRange(1, 1, numRows, numCols).getValues();

  for (var r = numRows - 1; r >= 1; r--) {
    var row = values[r];
    if (!row) continue;
    var cellId = row[6] != null ? String(row[6]).trim() : "";
    if (bookingId && cellId && cellId === bookingId) {
      sheet.deleteRow(r + 1);
      return;
    }
  }

  if (!ts && !name && !date && !slot) {
    return;
  }

  for (var r2 = numRows - 1; r2 >= 1; r2--) {
    var row2 = values[r2];
    if (!row2) continue;
    /** 與 listBookings_／前端 timestamp 一致（A 欄為 Date 時不可只用 String） */
    var rTs = cellToIsoOrString_(row2[0]).trim();
    var rName = row2[1] != null ? String(row2[1]).trim() : "";
    var rDate = cellDateYmd_(row2[2]);
    var rSlot = row2[3] != null ? String(row2[3]).trim() : "";
    if (rTs === ts && rName === name && rDate === date && rSlot === slot) {
      sheet.deleteRow(r2 + 1);
      return;
    }
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// ─────────────────────────────────────────────
// 明日預約提醒 Email（週日、週三 21:30 自動發送）
// ─────────────────────────────────────────────

var NOTIFY_EMAIL = "kuroh.0103@gmail.com";

var WEEKDAY_ZH = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

/**
 * 每日 21:30 執行，只在週日（0）或週三（3）實際寄信。
 * GAS Trigger 請設定 sendTomorrowBookingEmailIfNeeded，每日 21:00–22:00。
 */
function sendTomorrowBookingEmailIfNeeded() {
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var day = parseInt(Utilities.formatDate(now, tz, "u"), 10) % 7; // 0=Sun,1=Mon,...,6=Sat
  if (day !== 0 && day !== 3) return; // 只在週日、週三執行
  sendTomorrowBookingEmail_();
}

/**
 * 手動測試用：直接呼叫即可預覽寄信結果。
 */
function sendTomorrowBookingEmailNow() {
  sendTomorrowBookingEmail_();
}

function sendTomorrowBookingEmail_() {
  var tz = Session.getScriptTimeZone();
  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var tomorrowYmd = Utilities.formatDate(tomorrow, tz, "yyyy-MM-dd");

  // 取得明日所有預約
  var all = listBookings_();
  var rows = all.filter(function (b) {
    return b.date === tomorrowYmd;
  });

  // 組合信件
  var dateLabel = buildDateLabel_(tomorrow, tz);
  var subject = "📅 明日討論提醒 " + dateLabel;
  var body = buildEmailBody_(dateLabel, rows);

  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: subject,
    body: body,
  });
}

/** e.g. "4/9（週四）" */
function buildDateLabel_(date, tz) {
  var m = parseInt(Utilities.formatDate(date, tz, "M"), 10);
  var d = parseInt(Utilities.formatDate(date, tz, "d"), 10);
  var wdIdx = parseInt(Utilities.formatDate(date, tz, "u"), 10) % 7; // 0=Sun
  return m + "/" + d + "（" + WEEKDAY_ZH[wdIdx] + "）";
}

function buildEmailBody_(dateLabel, rows) {
  var lines = [];
  lines.push("📅 明日討論提醒 " + dateLabel);

  if (rows.length === 0) {
    lines.push("");
    lines.push("明日目前尚無預約。");
  } else {
    // 依時段分組，並按時段起始時間排序
    var slotMap = {};
    var slotOrder = [];
    rows.forEach(function (b) {
      var slot = b.slot || "（未填時段）";
      if (!slotMap[slot]) {
        slotMap[slot] = [];
        slotOrder.push(slot);
      }
      slotMap[slot].push(b);
    });

    // 按時段起始時間（HH:MM）排序
    slotOrder.sort(function (a, b) {
      return slotStartKey_(a) - slotStartKey_(b);
    });

    slotOrder.forEach(function (slot) {
      lines.push("");
      lines.push(slot);
      slotMap[slot].forEach(function (b) {
        var name = b.name || "（未填姓名）";
        var dur = b.duration || 30;
        lines.push("・" + name + "（" + dur + "min）");
      });
    });
  }

  lines.push("");
  lines.push("提醒請準時，如需異動請提前告知，謝謝 🙏");
  lines.push("（自動信件發送，詳情請確認預約系統行事曆）");

  return lines.join("\n");
}

/** "16:00–18:00" → 1600，方便排序 */
function slotStartKey_(slot) {
  var m = String(slot).match(/(\d{1,2}):(\d{2})/);
  if (!m) return 9999;
  return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
}

/**
 * 建立每日 21:00–22:00 的時間觸發器（只需執行一次）。
 * 若已有相同觸發器請勿重複執行，或先呼叫 removeDailyTrigger()。
 */
function setupDailyEmailTrigger() {
  ScriptApp.newTrigger("sendTomorrowBookingEmailIfNeeded")
    .timeBased()
    .everyDays(1)
    .atHour(21)
    .create();
  Logger.log("已建立每日 21:00–22:00 觸發器");
}

/** 移除所有 sendTomorrowBookingEmailIfNeeded 觸發器（用於重設）。 */
function removeDailyEmailTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === "sendTomorrowBookingEmailIfNeeded") {
      ScriptApp.deleteTrigger(t);
    }
  });
  Logger.log("已移除觸發器");
}
