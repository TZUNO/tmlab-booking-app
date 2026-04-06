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
 * 前端 POST JSON 欄位：timestamp、姓名、日期、時段、討論內容、備註
 * （與 teacher-booking-app/src/api.ts 的 SheetsPayload 一致）
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
  }

  var ts = data.timestamp || new Date().toISOString();
  var name = data["姓名"] || "";
  var date = data["日期"] || "";
  var slot = data["時段"] || "";
  var topics = data["討論內容"] || "";
  var note = data["備註"] || "";

  sheet.appendRow([ts, name, date, slot, topics, note]);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
