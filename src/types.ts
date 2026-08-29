export type Topic = "計劃執行" | "生涯" | "純聊天" | "學位論文" | "研討會或期刊" | "設計或競賽" | "其他備註";

export interface StudentGroup {
  label: string;
  students: string[];
}

export interface TimeSlotConfig {
  time: string;
  source: "fixed" | "extra";
}

export interface OpenDateConfig {
  date: string; // YYYY-MM-DD
  slots: TimeSlotConfig[];
  isExtraOpen: boolean;
  /** 老師關閉的時段（如 "16:00-17:00"）：會議等原因暫停，該時段不開放預約 */
  closedSlots?: string[];
}

export interface BookingRecord {
  id: string;
  timestamp: string;
  name: string;
  date: string;
  slot: string;
  duration: number;
  topics: Topic[];
  note: string;
}

export interface BookingFormValue {
  name: string;
  date: string;
  slot: string;
  duration: number;
  topics: Topic[];
  note: string;
}

export interface CalendarSlotView {
  time: string;
  /** 來自週一／週四固定或老師額外開放 */
  source?: "fixed" | "extra";
  bookings: BookingRecord[];
}

export interface CalendarDateView {
  date: string;
  isHoliday: boolean;
  holidayName?: string;
  isExtraOpen: boolean;
  /** 老師關閉的時段；slots 為空且此陣列非空＝整天關閉 */
  closedSlots: string[];
  slots: CalendarSlotView[];
}

export interface SheetsPayload {
  /** 與試算表「預約ID」欄一致，刪除時用此對應列 */
  bookingId: string;
  timestamp: string;
  姓名: string;
  日期: string;
  時段: string;
  討論內容: string;
  備註: string;
  /** 分鐘數，對應試算表 H 欄「預計耗時(分鐘)」 */
  durationMinutes: number;
}

/** POST body：action 為 delete 時由 GAS 刪除對應列 */
export interface SheetsDeletePayload {
  action: "delete";
  bookingId: string;
  timestamp: string;
  姓名: string;
  日期: string;
  時段: string;
}
