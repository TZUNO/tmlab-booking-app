import { INITIAL_BOOKINGS, TOPIC_OPTIONS } from "./data";
import type { BookingFormValue, BookingRecord, OpenDateConfig, SheetsDeletePayload, SheetsPayload, TimeSlotConfig, Topic } from "./types";
import { loadBookingsFromStorage, saveBookingsToStorage, saveTeacherPatchesToStorage } from "./storage";

const GAS_WEB_APP_URL = import.meta.env.VITE_GAS_WEB_APP_URL as string | undefined;

const TOPIC_SET = new Set<string>(TOPIC_OPTIONS);
const MOCK_BOOKING_IDS = new Set(INITIAL_BOOKINGS.map((b) => b.id));

/**
 * 伺服器列舉與本機合併：同 id 以伺服器為準；僅在本機的 id（例如尚未寫入試算表成功）保留。
 * 若伺服器回傳空陣列但本機有資料，不覆寫本機（避免試算表讀取失敗時清空畫面）。
 */
function mergeBookingsFromServer(server: BookingRecord[], local: BookingRecord[]): BookingRecord[] {
  if (server.length === 0 && local.length > 0) {
    return [...local];
  }
  const byId = new Map<string, BookingRecord>();
  for (const b of server) {
    if (b.id) byId.set(b.id, b);
  }
  for (const b of local) {
    if (!b.id || byId.has(b.id)) continue;
    if (server.length > 0 && MOCK_BOOKING_IDS.has(b.id)) continue;
    byId.set(b.id, b);
  }
  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot));
}

function parseTopics(raw: unknown): Topic[] {
  if (Array.isArray(raw)) {
    return raw
      .map((t) => (typeof t === "string" ? t.trim() : ""))
      .filter((t): t is Topic => TOPIC_SET.has(t));
  }
  const s = String(raw ?? "");
  if (!s.trim()) return [];
  return s
    .split(/[、,，]/)
    .map((t) => t.trim())
    .filter((t): t is Topic => TOPIC_SET.has(t));
}

/** getState 成功時：試算表上的老師額外時段 JSON 為唯一真相，勿與本機 merge（否則本機舊資料會蓋掉他裝置已刪除的時段並被自動存回試算表）。 */
function cloneTeacherPatchesFromServer(patches: OpenDateConfig[]): OpenDateConfig[] {
  return patches.map((c) => ({
    date: c.date,
    isExtraOpen: Boolean(c.isExtraOpen),
    slots: c.slots.map(
      (s): TimeSlotConfig => ({
        time: s.time,
        source: s.source === "extra" ? "extra" : "fixed",
      })
    ),
  }));
}

function normalizeBooking(raw: Record<string, unknown>, rowIndex: number): BookingRecord {
  const name = String(raw.name ?? raw["姓名"] ?? "").trim();
  const date = String(raw.date ?? raw["日期"] ?? "").trim();
  const slot = String(raw.slot ?? raw["時段"] ?? "").trim();
  const timestamp = String(raw.timestamp ?? "").trim();
  const note = String(raw.note ?? raw["備註"] ?? "").trim();
  let id = String(raw.id ?? raw.bookingId ?? "").trim();
  if (!id) {
    id = `sheet-${rowIndex}-${date}-${slot}-${name}`;
  }
  const topicsRaw = raw.topics ?? raw["討論內容"];
  return {
    id,
    timestamp,
    name,
    date,
    slot,
    duration: typeof raw.duration === "number" && Number.isFinite(raw.duration) ? raw.duration : 30,
    topics: parseTopics(topicsRaw),
    note,
  };
}

/** 與頁面重整無關：從 localStorage 還原（同裝置離線備援） */
let bookingStore: BookingRecord[] = loadBookingsFromStorage();

function persistBookings(): void {
  saveBookingsToStorage(bookingStore);
}

/**
 * 從 GAS 讀取「預約紀錄」分頁 +「老師開放時段」分頁 JSON，寫回 localStorage。
 * 失敗時回傳 null，前端沿用本機資料。
 */
export async function syncAppStateFromServer(): Promise<{
  bookings: BookingRecord[];
  teacherPatches: OpenDateConfig[];
} | null> {
  if (!GAS_WEB_APP_URL) return null;
  const localBookings = loadBookingsFromStorage();
  try {
    const res = await fetch(GAS_WEB_APP_URL, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "getState" }),
    });
    const rawText = await res.text();
    if (!res.ok) {
      console.warn("[TMLab] getState HTTP", res.status, rawText.slice(0, 200));
      return null;
    }
    let json: { ok?: boolean; bookings?: unknown[]; teacherPatches?: unknown };
    try {
      json = JSON.parse(rawText) as typeof json;
    } catch {
      console.warn("[TMLab] getState response is not JSON", rawText.slice(0, 200));
      return null;
    }
    if (!json.ok || !Array.isArray(json.bookings)) return null;

    const serverBookings = json.bookings.map((row, i) => normalizeBooking(row as Record<string, unknown>, i));
    const serverPatches = Array.isArray(json.teacherPatches) ? (json.teacherPatches as OpenDateConfig[]) : [];

    const mergedBookings = mergeBookingsFromServer(serverBookings, localBookings);
    /** 與預約不同：patches 整份以伺服器為準（含空陣列＝老師已清空額外時段）。 */
    const mergedPatches = cloneTeacherPatchesFromServer(serverPatches);

    bookingStore = mergedBookings;
    persistBookings();
    saveTeacherPatchesToStorage(mergedPatches);
    return { bookings: bookingStore, teacherPatches: mergedPatches };
  } catch (e) {
    console.warn("[TMLab] syncAppStateFromServer failed", e);
    return null;
  }
}

/** 老師開放時段變更時同步到試算表「老師開放時段」分頁（A1 JSON） */
export async function saveTeacherPatchesRemote(patches: OpenDateConfig[]): Promise<void> {
  if (!GAS_WEB_APP_URL) return;
  try {
    await fetch(GAS_WEB_APP_URL, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "saveTeacherPatches", teacherPatches: patches }),
    });
  } catch (e) {
    console.warn("[TMLab] saveTeacherPatchesRemote failed", e);
  }
}

export async function fetchBookings(): Promise<BookingRecord[]> {
  return [...bookingStore].sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot));
}

export async function createBooking(input: BookingFormValue): Promise<BookingRecord> {
  const record: BookingRecord = {
    id: `bk-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    name: input.name,
    date: input.date,
    slot: input.slot,
    duration: input.duration,
    topics: input.topics,
    note: input.note.trim(),
  };

  bookingStore = [...bookingStore, record];
  persistBookings();
  await logToGoogleSheets(record);
  return record;
}

export async function deleteBooking(id: string): Promise<void> {
  const removed = bookingStore.find((item) => item.id === id);
  bookingStore = bookingStore.filter((item) => item.id !== id);
  persistBookings();
  if (removed) {
    await deleteFromGoogleSheets(removed);
  }
}

export async function logToGoogleSheets(record: BookingRecord): Promise<void> {
  const payload: SheetsPayload = {
    bookingId: record.id,
    timestamp: record.timestamp,
    姓名: record.name,
    日期: record.date,
    時段: record.slot,
    討論內容: record.topics.join("、"),
    備註: record.note,
  };

  if (!GAS_WEB_APP_URL) {
    console.info("[Mock] Google Sheets payload", payload);
    return;
  }

  try {
    await fetch(GAS_WEB_APP_URL, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("Failed to log booking to Google Sheets", error);
  }
}

async function deleteFromGoogleSheets(record: BookingRecord): Promise<void> {
  const payload: SheetsDeletePayload = {
    action: "delete",
    bookingId: record.id,
    timestamp: record.timestamp,
    姓名: record.name,
    日期: record.date,
    時段: record.slot,
  };

  if (!GAS_WEB_APP_URL) {
    console.info("[Mock] Google Sheets delete", payload);
    return;
  }

  try {
    await fetch(GAS_WEB_APP_URL, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("Failed to delete booking row in Google Sheets", error);
  }
}
