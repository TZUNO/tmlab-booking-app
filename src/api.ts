import type { BookingFormValue, BookingRecord, SheetsDeletePayload, SheetsPayload } from "./types";
import { loadBookingsFromStorage, saveBookingsToStorage } from "./storage";

const GAS_WEB_APP_URL = import.meta.env.VITE_GAS_WEB_APP_URL as string | undefined;

/** 與頁面重整無關：從 localStorage 還原（跨同一瀏覽器／同一裝置有效） */
let bookingStore: BookingRecord[] = loadBookingsFromStorage();

function persistBookings(): void {
  saveBookingsToStorage(bookingStore);
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

// Google Sheets API 預留層：可改接 GAS doPost 或 Google Sheets API。
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
    // 不中斷預約流程，避免使用者因記錄失敗而無法完成預約。
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
