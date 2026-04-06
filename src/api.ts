import { TOPIC_OPTIONS } from "./data";
import type { BookingFormValue, BookingRecord, OpenDateConfig, SheetsDeletePayload, SheetsPayload, Topic } from "./types";
import { loadBookingsFromStorage, saveBookingsToStorage, saveTeacherPatchesToStorage } from "./storage";

const GAS_WEB_APP_URL = import.meta.env.VITE_GAS_WEB_APP_URL as string | undefined;

const TOPIC_SET = new Set<string>(TOPIC_OPTIONS);

function parseTopics(raw: unknown): Topic[] {
  if (Array.isArray(raw)) {
    return raw.filter((t): t is Topic => typeof t === "string" && TOPIC_SET.has(t));
  }
  const s = String(raw ?? "");
  if (!s.trim()) return [];
  return s
    .split("、")
    .map((t) => t.trim())
    .filter((t): t is Topic => TOPIC_SET.has(t));
}

function normalizeBooking(raw: Record<string, unknown>): BookingRecord {
  return {
    id: String(raw.id ?? ""),
    timestamp: String(raw.timestamp ?? ""),
    name: String(raw.name ?? ""),
    date: String(raw.date ?? ""),
    slot: String(raw.slot ?? ""),
    duration: typeof raw.duration === "number" && Number.isFinite(raw.duration) ? raw.duration : 30,
    topics: parseTopics(raw.topics),
    note: String(raw.note ?? ""),
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
  try {
    const res = await fetch(GAS_WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "getState" }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      bookings?: unknown[];
      teacherPatches?: unknown;
    };
    if (!json.ok || !Array.isArray(json.bookings)) return null;

    const bookings = json.bookings.map((row) => normalizeBooking(row as Record<string, unknown>));
    let teacherPatches: OpenDateConfig[] = [];
    if (Array.isArray(json.teacherPatches)) {
      teacherPatches = json.teacherPatches as OpenDateConfig[];
    }
    bookingStore = [...bookings];
    persistBookings();
    saveTeacherPatchesToStorage(teacherPatches);
    return { bookings: bookingStore, teacherPatches };
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
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("Failed to delete booking row in Google Sheets", error);
  }
}
