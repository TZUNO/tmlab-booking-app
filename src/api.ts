import { INITIAL_BOOKINGS, TOPIC_OPTIONS } from "./data";
import type { BookingFormValue, BookingRecord, OpenDateConfig, SheetsDeletePayload, SheetsPayload, TimeSlotConfig, Topic } from "./types";

const GAS_WEB_APP_URL = import.meta.env.VITE_GAS_WEB_APP_URL as string | undefined;

/** 有設定 Web App URL 時，預約與老師額外時段皆以 GAS／試算表為唯一真相（不靠 localStorage）。 */
export const isGasConfigured = Boolean(GAS_WEB_APP_URL && String(GAS_WEB_APP_URL).trim() !== "");

const TOPIC_SET = new Set<string>(TOPIC_OPTIONS);

function sortBookings(list: BookingRecord[]): BookingRecord[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot));
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

/** getState 成功時：試算表上的老師額外時段 JSON 為唯一真相。 */
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

/** 執行中狀態：有 GAS 時僅由 syncAppStateFromServer 寫入；無 GAS 時為本機示範用記憶體 */
let bookingStore: BookingRecord[] = isGasConfigured ? [] : [...INITIAL_BOOKINGS];

/**
 * 從 GAS 讀取「預約紀錄」+「老師開放時段」JSON，覆寫記憶體中的 bookingStore（與回傳值一致）。
 * 失敗時回傳 null，不修改 bookingStore。
 */
export async function syncAppStateFromServer(): Promise<{
  bookings: BookingRecord[];
  teacherPatches: OpenDateConfig[];
} | null> {
  if (!GAS_WEB_APP_URL) return null;
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

    bookingStore = sortBookings(serverBookings);
    const mergedPatches = cloneTeacherPatchesFromServer(serverPatches);
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
  return sortBookings(bookingStore);
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

  if (!isGasConfigured) {
    bookingStore = [...bookingStore, record];
    return record;
  }

  await logToGoogleSheets(record);
  const synced = await syncAppStateFromServer();
  if (synced) {
    const found = bookingStore.find((b) => b.id === record.id);
    if (found) return found;
  }
  /** 寫入後短暫延遲再拉一次（試算表 eventual consistency 極少見） */
  await new Promise((r) => window.setTimeout(r, 350));
  await syncAppStateFromServer();
  const found = bookingStore.find((b) => b.id === record.id);
  return found ?? record;
}

export async function deleteBooking(id: string): Promise<void> {
  const removed = bookingStore.find((item) => item.id === id);
  if (!isGasConfigured) {
    bookingStore = bookingStore.filter((item) => item.id !== id);
    return;
  }
  if (removed) {
    await deleteFromGoogleSheets(removed);
  }
  const ok = await syncAppStateFromServer();
  if (!ok && removed) {
    bookingStore = sortBookings(bookingStore.filter((item) => item.id !== id));
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
