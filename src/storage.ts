import { INITIAL_BOOKINGS } from "./data";
import type { BookingRecord, OpenDateConfig } from "./types";

/** 換資料結構時可改版號，避免讀到舊格式 */
const KEY_BOOKINGS = "tmlab-bookings-v1";
const KEY_TEACHER_PATCHES = "tmlab-teacher-patches-v1";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** 第一次開啟網站（尚無紀錄）仍使用程式內 mock；一旦有寫入則以 localStorage 為準 */
export function loadBookingsFromStorage(): BookingRecord[] {
  if (!canUseStorage()) return [...INITIAL_BOOKINGS];
  try {
    const raw = localStorage.getItem(KEY_BOOKINGS);
    if (raw === null) return [...INITIAL_BOOKINGS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...INITIAL_BOOKINGS];
    return parsed as BookingRecord[];
  } catch {
    return [...INITIAL_BOOKINGS];
  }
}

export function saveBookingsToStorage(bookings: BookingRecord[]): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(KEY_BOOKINGS, JSON.stringify(bookings));
  } catch (e) {
    console.warn("[TMLab] 無法寫入預約紀錄（可能超過容量或隱私模式）", e);
  }
}

export function loadTeacherPatchesFromStorage(): OpenDateConfig[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(KEY_TEACHER_PATCHES);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as OpenDateConfig[];
  } catch {
    return [];
  }
}

export function saveTeacherPatchesToStorage(patches: OpenDateConfig[]): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(KEY_TEACHER_PATCHES, JSON.stringify(patches));
  } catch (e) {
    console.warn("[TMLab] 無法寫入老師開放時段", e);
  }
}
