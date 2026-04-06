import { EXTRA_OPEN_DATES, FIXED_TIME_SLOTS, HOLIDAYS } from "./data";
import type { CalendarDateView, OpenDateConfig } from "./types";

export function isHoliday(dateStr: string): { isHoliday: boolean; name?: string } {
  const holiday = HOLIDAYS.find((h) => h.date === dateStr);
  return holiday ? { isHoliday: true, name: holiday.name } : { isHoliday: false };
}

export function formatDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()} (週${weekday})`;
}

export function formatMonthTitle(date: Date): string {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

export function getWeekdayHeaders(): string[] {
  return ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
}

export function startOfMonthGrid(date: Date): Date {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return start;
}

export function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 0=週日 … 6=週六（依本機時區） */
export function getWeekdayIndex(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00`).getDay();
}

export function isMondayOrThursday(dateStr: string): boolean {
  const w = getWeekdayIndex(dateStr);
  return w === 1 || w === 4;
}

/** 僅比較日曆日：dateStr 是否早於今天 */
export function isCalendarDateBeforeToday(dateStr: string): boolean {
  return dateStr < toDateString(new Date());
}

export function buildOpenDateConfigs(from = new Date(), weeks = 6): OpenDateConfig[] {
  const map = new Map<string, OpenDateConfig>();
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);

  const totalDays = weeks * 7;
  for (let i = 0; i < totalDays; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const day = d.getDay();
    if (day === 1 || day === 4) {
      const date = toDateString(d);
      if (!isHoliday(date).isHoliday) {
        map.set(date, {
          date,
          isExtraOpen: false,
          slots: FIXED_TIME_SLOTS.map((time) => ({ time, source: "fixed" as const })),
        });
      }
    }
  }

  for (const extra of EXTRA_OPEN_DATES) {
    if (isHoliday(extra.date).isHoliday) continue;
    const existing = map.get(extra.date);
    const extraSlots = extra.slots.map((time) => ({ time, source: "extra" as const }));
    if (existing) {
      const merged = new Map(existing.slots.map((s) => [s.time, s]));
      for (const slot of extraSlots) merged.set(slot.time, slot);
      existing.slots = [...merged.values()].sort((a, b) => a.time.localeCompare(b.time));
      existing.isExtraOpen = true;
    } else {
      map.set(extra.date, { date: extra.date, slots: extraSlots, isExtraOpen: true });
    }
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function buildCalendarWithHolidays(openDateConfigs: OpenDateConfig[]): CalendarDateView[] {
  const today = new Date();
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const days = 21;

  const openMap = new Map(openDateConfigs.map((item) => [item.date, item]));
  const cards: CalendarDateView[] = [];

  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const date = toDateString(d);
    const holiday = isHoliday(date);
    const open = openMap.get(date);

    cards.push({
      date,
      isHoliday: holiday.isHoliday,
      holidayName: holiday.name,
      isExtraOpen: open?.isExtraOpen ?? false,
      slots: (open?.slots ?? []).map((slot) => ({ time: slot.time, bookings: [] })),
    });
  }

  return cards;
}
