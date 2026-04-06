import { useEffect, useMemo, useState } from "react";
import { createBooking, deleteBooking, fetchBookings, fetchOpenDates } from "./api";
import { DURATION_OPTIONS, STUDENT_GROUPS, TOPIC_OPTIONS } from "./data";
import {
  formatDateLabel,
  formatMonthTitle,
  getWeekdayHeaders,
  isHoliday,
  startOfMonthGrid,
  toDateString,
} from "./date-utils";
import type { BookingFormValue, BookingRecord, CalendarDateView, OpenDateConfig, Topic } from "./types";

const EMPTY_FORM: BookingFormValue = {
  name: "",
  date: "",
  slot: "",
  duration: 30,
  topics: [],
  note: "",
};

function topicText(topics: Topic[]): string {
  return topics.length ? topics.join("、") : "未填";
}

export default function App() {
  const [form, setForm] = useState<BookingFormValue>(EMPTY_FORM);
  const [openDates, setOpenDates] = useState<OpenDateConfig[]>([]);
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [teacherEditMode, setTeacherEditMode] = useState(false);

  useEffect(() => {
    Promise.all([fetchOpenDates(), fetchBookings()]).then(([dateConfigs, bookingData]) => {
      setOpenDates(dateConfigs);
      setBookings(bookingData);
    });
  }, []);

  const dateOptions = openDates.map((d) => d.date);
  const slotOptions = useMemo(
    () => openDates.find((d) => d.date === form.date)?.slots.map((slot) => slot.time) ?? [],
    [form.date, openDates]
  );

  const dateMap = useMemo(() => new Map(openDates.map((item) => [item.date, item])), [openDates]);

  const monthDates = useMemo(() => {
    const start = startOfMonthGrid(monthCursor);
    return Array.from({ length: 42 }).map((_, idx) => {
      const d = new Date(start);
      d.setDate(start.getDate() + idx);
      const date = toDateString(d);
      return {
        date,
        day: d.getDate(),
        inCurrentMonth: d.getMonth() === monthCursor.getMonth(),
        weekday: d.getDay(),
      };
    });
  }, [monthCursor]);

  const calendarData = useMemo((): CalendarDateView[] => {
    const rows: CalendarDateView[] = [];
    for (const item of monthDates) {
      const holiday = isHoliday(item.date);
      const open = dateMap.get(item.date);
      const slots = (open?.slots ?? []).map((slot) => ({
        time: slot.time,
        bookings: bookings.filter((b) => b.date === item.date && b.slot === slot.time),
      }));
      rows.push({
        date: item.date,
        isHoliday: holiday.isHoliday,
        holidayName: holiday.name,
        isExtraOpen: open?.isExtraOpen ?? false,
        slots,
      });
    }
    return rows;
  }, [monthDates, dateMap, bookings]);

  const selectedDateView = useMemo(() => {
    const fallback = selectedDate || form.date || toDateString(new Date());
    return calendarData.find((d) => d.date === fallback);
  }, [calendarData, selectedDate, form.date]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.date || !form.slot || form.topics.length === 0) {
      setMessage("請完整填寫姓名、日期、時段與討論內容。");
      return;
    }
    setSaving(true);
    setMessage("");
    await createBooking(form);
    const updated = await fetchBookings();
    setBookings(updated);
    setSelectedDate(form.date);
    const selected = new Date(`${form.date}T00:00:00`);
    setMonthCursor(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setForm((prev) => ({ ...EMPTY_FORM, date: prev.date }));
    setSaving(false);
    setMessage("預約成功！已完成登記。");
  }

  async function onDelete(id: string) {
    await deleteBooking(id);
    const updated = await fetchBookings();
    setBookings(updated);
  }

  function addExtraOpenSlot(date: string) {
    const holiday = isHoliday(date);
    if (holiday.isHoliday) {
      setMessage("國定假日不可新增開放時段。");
      return;
    }

    const value = window.prompt(
      "請輸入要新增的時段（HH:MM-HH:MM），可用逗號分隔多個。\n例如：18:30-19:00,19:00-19:30"
    );
    if (!value) return;

    const parsed = value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    const isValid = parsed.every((v) => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(v));
    if (!isValid) {
      setMessage("時段格式錯誤，請使用 HH:MM-HH:MM。");
      return;
    }

    setOpenDates((prev) => {
      const found = prev.find((item) => item.date === date);
      if (!found) {
        return [
          ...prev,
          {
            date,
            isExtraOpen: true,
            slots: parsed.map((time) => ({ time, source: "extra" as const })),
          },
        ].sort((a, b) => a.date.localeCompare(b.date));
      }

      const merged = new Map(found.slots.map((slot) => [slot.time, slot]));
      for (const time of parsed) merged.set(time, { time, source: "extra" as const });

      return prev.map((item) =>
        item.date === date
          ? {
              ...item,
              isExtraOpen: true,
              slots: [...merged.values()].sort((a, b) => a.time.localeCompare(b.time)),
            }
          : item
      );
    });

    setMessage(`已新增 ${date} 的額外時段。`);
  }

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-head">
          <h1>東明研TMLab@NTUT 討論預約系統</h1>
          <button
            type="button"
            className={`teacher-mode-btn ${teacherEditMode ? "on" : ""}`}
            onClick={() => setTeacherEditMode((v) => !v)}
          >
            {teacherEditMode ? "老師編輯模式：開啟" : "老師編輯模式：關閉"}
          </button>
        </div>
        <p>固定開放：週一 / 週四（16:00 後）・國定假日不開放・填寫後即預約成功・預設地點：3F 研究室</p>
      </header>

      <main className="layout">
        <section className="panel form-panel">
          <h2>填表預約</h2>
          <form onSubmit={onSubmit} className="form">
            <label>
              姓名
              <select
                value={form.name}
                onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
                required
              >
                <option value="">請選擇姓名</option>
                {STUDENT_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.students.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <label>
              日期
              <select
                value={form.date}
                onChange={(e) => setForm((v) => ({ ...v, date: e.target.value, slot: "" }))}
                required
              >
                <option value="">請選擇可預約日期</option>
                {dateOptions.map((date) => (
                  <option key={date} value={date}>
                    {formatDateLabel(date)}
                    {openDates.find((d) => d.date === date)?.isExtraOpen ? "（額外開放）" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label>
              時段
              <select
                value={form.slot}
                onChange={(e) => setForm((v) => ({ ...v, slot: e.target.value }))}
                required
                disabled={!form.date}
              >
                <option value="">請選擇時段</option>
                {slotOptions.map((slot) => {
                  const count = bookings.filter((b) => b.date === form.date && b.slot === slot).length;
                  return (
                    <option key={slot} value={slot}>
                      {slot} {count > 0 ? `（已有 ${count} 人預約）` : "（可預約）"}
                    </option>
                  );
                })}
              </select>
            </label>

            <label>
              預計耗時
              <select
                value={form.duration}
                onChange={(e) => setForm((v) => ({ ...v, duration: Number(e.target.value) }))}
              >
                {DURATION_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} 分鐘
                  </option>
                ))}
              </select>
            </label>

            <div className="topic-group">
              <span>討論內容（可複選）</span>
              <div className="chips">
                {TOPIC_OPTIONS.map((topic) => {
                  const active = form.topics.includes(topic);
                  return (
                    <button
                      key={topic}
                      type="button"
                      className={`chip ${active ? "active" : ""}`}
                      onClick={() =>
                        setForm((v) => ({
                          ...v,
                          topics: active ? v.topics.filter((t) => t !== topic) : [...v.topics, topic],
                        }))
                      }
                    >
                      {topic}
                    </button>
                  );
                })}
              </div>
            </div>

            <label>
              備註
              <textarea
                value={form.note}
                onChange={(e) => setForm((v) => ({ ...v, note: e.target.value }))}
                placeholder="可補充想討論的內容。預設地點為 3F 研究室。"
                rows={4}
              />
            </label>

            <button type="submit" disabled={saving}>
              {saving ? "送出中..." : "確認送出預約"}
            </button>
            {message ? <p className="message">{message}</p> : null}
          </form>
        </section>

        <section className="panel calendar-panel">
          <h2>預約行事曆時段總覽</h2>
          <div className="month-head">
            <strong>{formatMonthTitle(monthCursor)}</strong>
            <div className="month-actions">
              <button type="button" onClick={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>
                ‹
              </button>
              <button type="button" onClick={() => setMonthCursor(new Date())}>
                今天
              </button>
              <button type="button" onClick={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>
                ›
              </button>
            </div>
          </div>

          <div className="weekday-row">
            {getWeekdayHeaders().map((name) => (
              <div key={name}>{name}</div>
            ))}
          </div>
          <div className="month-grid">
            {calendarData.map((day) => {
              const inCurrentMonth = monthCursor.getMonth() === new Date(`${day.date}T00:00:00`).getMonth();
              const totalBookings = day.slots.reduce((acc, slot) => acc + slot.bookings.length, 0);
              const canTeacherAdd = teacherEditMode && !day.isHoliday && day.slots.length === 0;
              return (
                <article
                  key={day.date}
                  className={`month-cell ${!inCurrentMonth ? "outside" : ""} ${day.isHoliday ? "holiday" : ""}`}
                  onClick={() => setSelectedDate(day.date)}
                >
                  <div className="cell-head">
                    <span>{new Date(`${day.date}T00:00:00`).getDate()}</span>
                    <div className="badges">
                      {day.isHoliday ? <span className="badge holiday">休</span> : null}
                      {!day.isHoliday && day.isExtraOpen ? <span className="badge extra">額外</span> : null}
                      {canTeacherAdd ? (
                        <button
                          type="button"
                          className="add-open-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            addExtraOpenSlot(day.date);
                          }}
                        >
                          + 老師新增
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="cell-body">
                    {day.isHoliday ? (
                      <p className="holiday-text">{day.holidayName}</p>
                    ) : totalBookings === 0 ? (
                      <p className="empty">尚無預約</p>
                    ) : (
                      day.slots
                        .filter((slot) => slot.bookings.length > 0)
                        .slice(0, 3)
                        .map((slot) => (
                          <p key={`${day.date}-${slot.time}`} className="event-line">
                            {slot.time} {slot.bookings.map((b) => b.name).join("、")}
                          </p>
                        ))
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="detail-board">
            <div className="detail-head">
              <strong>{selectedDateView ? formatDateLabel(selectedDateView.date) : "請選擇日期"}</strong>
              {selectedDateView && !selectedDateView.isHoliday && selectedDateView.isExtraOpen ? (
                <span className="badge extra">額外開放</span>
              ) : null}
            </div>
            {selectedDateView ? (
              selectedDateView.isHoliday ? (
                <p className="holiday-text">國定假日不可預約（{selectedDateView.holidayName}）。</p>
              ) : selectedDateView.slots.length === 0 ? (
                <p className="empty">
                  當日尚未開放時段。
                  {teacherEditMode ? "可用月曆格內 + 老師新增。" : "請由老師開啟編輯模式後新增。"}
                </p>
              ) : (
                <ul className="slots">
                  {selectedDateView.slots.map((slot) => (
                    <li key={`${selectedDateView.date}-${slot.time}`} className="slot">
                      <div className="slot-time">{slot.time}</div>
                      {slot.bookings.length === 0 ? (
                        <p className="empty">目前空白時段</p>
                      ) : (
                        <div className="records">
                          {slot.bookings.map((booking) => (
                            <div key={booking.id} className="record">
                              <div>
                                <strong>{booking.name}</strong> ・ {booking.duration} 分鐘
                              </div>
                              <div>主題：{topicText(booking.topics)}</div>
                              <div>備註：{booking.note || "—"}</div>
                              <button type="button" className="delete-btn" onClick={() => onDelete(booking.id)}>
                                刪除此筆
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <p className="empty">請在月曆中點選日期查看明細。</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
