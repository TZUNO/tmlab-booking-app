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
 * - 新增：bookingId、timestamp、姓名、日期、時段、討論內容、備註
 * - 刪除：{ "action":"delete", "bookingId", "timestamp", "姓名", "日期", "時段" }
 */

/**
 * 綁定腳本：設為 null，會用 SpreadsheetApp.getActiveSpreadsheet()
 * 獨立腳本：設為試算表 ID（網址 /d/ 與 /edit 之間）
 */
var SPREADSHEET_ID = "1MZdOExiJqcB9NT2auEtGQSgTKNJq-44-zk01yRcN61o";

var SHEET_NAME = "預約紀錄";

var SHEET_HEADERS = [
  "timestamp",
  "姓名",
  "日期",
  "時段",
  "討論內容",
  "備註",
  "預約ID",
];

function getSpreadsheet_() {
  if (SPREADSHEET_ID && String(SPREADSHEET_ID).trim() !== "") {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
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

function appendBookingRow_(data) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(SHEET_HEADERS);
  } else {
    ensureBookingIdHeader_(sheet);
  }

  var ts = data.timestamp || new Date().toISOString();
  var name = data["姓名"] || "";
  var date = data["日期"] || "";
  var slot = data["時段"] || "";
  var topics = data["討論內容"] || "";
  var note = data["備註"] || "";
  var bookingId = data.bookingId != null ? String(data.bookingId) : "";

  sheet.appendRow([ts, name, date, slot, topics, note, bookingId]);
}

/**
 * 舊表只有 6 欄時，補上 G1「預約ID」標題（不動既有資料列）。
 */
function ensureBookingIdHeader_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 7) {
    sheet.getRange(1, 7).setValue("預約ID");
  } else if (String(sheet.getRange(1, 7).getValue() || "").trim() === "") {
    sheet.getRange(1, 7).setValue("預約ID");
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
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    return;
  }

  var numRows = sheet.getLastRow();
  if (numRows < 2) {
    return;
  }

  var numCols = Math.max(sheet.getLastColumn(), 7);
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
    var rTs = row2[0] != null ? String(row2[0]).trim() : "";
    var rName = row2[1] != null ? String(row2[1]).trim() : "";
    var rDate = row2[2] != null ? String(row2[2]).trim() : "";
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
