import { useEffect, useMemo, useRef, useState } from "react";
import {
  createBooking,
  deleteBooking,
  fetchBookings,
  isGasConfigured,
  saveTeacherPatchesRemote,
  syncAppStateFromServer,
} from "./api";
import { DURATION_OPTIONS, INITIAL_BOOKINGS, STUDENT_GROUPS, TOPIC_OPTIONS } from "./data";
import {
  addCalendarDays,
  buildOpenDateConfigsForInclusiveRange,
  buildOpenDateConfigsForMonth,
  coerceEndAfterStart,
  endTimeOptionsAfter,
  formatDateLabel,
  formatMonthTitle,
  getWeekdayHeaders,
  hourlyTimeOptionsTeacherExtra,
  isCalendarDateBeforeToday,
  isHoliday,
  mergeOpenDateConfigs,
  startOfMonthGrid,
  timeToMinutes,
  toDateString,
} from "./date-utils";
import type { BookingFormValue, BookingRecord, CalendarDateView, OpenDateConfig, Topic } from "./types";
import { WheelTimeSelect } from "./WheelTimeSelect";

/** 表單「日期」下拉：含今日起共幾個曆日可選（跨月） */
const FORM_BOOKING_WINDOW_DAYS = 30;

const EMPTY_FORM: BookingFormValue = {
  name: "",
  date: "",
  slot: "",
  duration: 60,
  topics: [],
  note: "",
};

function topicText(topics: Topic[]): string {
  return topics.length ? topics.join("、") : "未填";
}

/** 老師一鍵帶入常見時段 */
const TEACHER_SLOT_PRESETS: { label: string; start: string; end: string }[] = [
  { label: "16:00–17:00", start: "16:00", end: "17:00" },
  { label: "17:00–18:00", start: "17:00", end: "18:00" },
  { label: "18:00–19:00", start: "18:00", end: "19:00" },
  { label: "19:00–20:00", start: "19:00", end: "20:00" },
];

export default function App() {
  const todayStr = toDateString(new Date());
  /** 老師新增開放時段：09:00 起至 20:00；開始最晚 19:00 */
  const teacherModalTimeChoices = useMemo(() => hourlyTimeOptionsTeacherExtra(), []);
  const teacherSlotStartChoices = useMemo(
    () => teacherModalTimeChoices.filter((t) => timeToMinutes(t) <= 19 * 60),
    [teacherModalTimeChoices]
  );

  const [form, setForm] = useState<BookingFormValue>(EMPTY_FORM);
  /** 有 GAS 時由試算表同步；無 GAS 時僅記憶體示範 */
  const [teacherPatches, setTeacherPatches] = useState<OpenDateConfig[]>(() => []);
  const [bookings, setBookings] = useState<BookingRecord[]>(() =>
    isGasConfigured ? [] : [...INITIAL_BOOKINGS]
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [teacherEditMode, setTeacherEditMode] = useState(false);
  /** 老師新增額外開放時段：用下拉選單選開始／結束時間 */
  const [addSlotModal, setAddSlotModal] = useState<{ date: string } | null>(null);
  const [slotStart, setSlotStart] = useState("16:00");
  const [slotEnd, setSlotEnd] = useState("17:00");
  /** 首次從 GAS／本機載入完成前，不把 teacherPatches 推上試算表，避免覆寫遠端 */
  const [syncReady, setSyncReady] = useState(false);
  /** 與 useRef 同步，供事件 handler 判斷是否已完成初次載入 */
  const syncReadyRef = useRef(false);
  /** 初次載入後，背景 getState 進行中（切回分頁／focus 等） */
  const [calendarBackgroundSyncing, setCalendarBackgroundSyncing] = useState(false);
  /** 本機正在編輯額外時段時，背景同步勿覆寫 teacherPatches（避免未存回的變更被舊的試算表狀態蓋掉） */
  const teacherPatchesDirtyRef = useRef(false);
  /** 與 debounce 搭配：僅「對應到目前這版 patches 的那次存檔」完成時才清除 dirty */
  const patchSaveGenerationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const state = await syncAppStateFromServer();
      if (cancelled) return;
      if (state) {
        setBookings(state.bookings);
        setTeacherPatches(state.teacherPatches);
      } else {
        const list = await fetchBookings();
        setBookings(list);
      }
      setSyncReady(true);
      syncReadyRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 切回分頁或網路恢復時再拉試算表，讓跨裝置／多人看到最新預約 */
  const lastBackgroundSyncRef = useRef(0);
  useEffect(() => {
    const run = () => {
      if (!syncReadyRef.current) return;
      const now = Date.now();
      if (now - lastBackgroundSyncRef.current < 2500) return;
      lastBackgroundSyncRef.current = now;
      setCalendarBackgroundSyncing(true);
      void syncAppStateFromServer()
        .then((state) => {
          if (!state) return;
          setBookings(state.bookings);
          if (!teacherPatchesDirtyRef.current) {
            setTeacherPatches(state.teacherPatches);
          }
        })
        .finally(() => setCalendarBackgroundSyncing(false));
    };
    const onVis = () => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("online", run);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("online", run);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    if (!syncReady) return;
    patchSaveGenerationRef.current += 1;
    const gen = patchSaveGenerationRef.current;
    const t = window.setTimeout(() => {
      void saveTeacherPatchesRemote(teacherPatches).finally(() => {
        if (patchSaveGenerationRef.current === gen) {
          teacherPatchesDirtyRef.current = false;
        }
      });
    }, 500);
    return () => clearTimeout(t);
  }, [teacherPatches, syncReady]);

  const formRangeEndStr = useMemo(
    () => addCalendarDays(todayStr, FORM_BOOKING_WINDOW_DAYS - 1),
    [todayStr]
  );

  const baseOpenThisMonth = useMemo(
    () => buildOpenDateConfigsForMonth(monthCursor),
    [monthCursor]
  );

  const baseOpenFormWindow = useMemo(
    () => buildOpenDateConfigsForInclusiveRange(todayStr, formRangeEndStr),
    [todayStr, formRangeEndStr]
  );

  /** 月曆＋表單：合併「今日起 30 天」與「目前檢視月」與老師額外開放 */
  const openDates = useMemo(
    () =>
      mergeOpenDateConfigs(mergeOpenDateConfigs(baseOpenFormWindow, baseOpenThisMonth), teacherPatches),
    [baseOpenFormWindow, baseOpenThisMonth, teacherPatches]
  );

  /** 表單僅列出「今天起（含）」30 天內可預約日（可跨月） */
  const dateOptions = useMemo(
    () =>
      openDates
        .filter((d) => d.date >= todayStr && d.date <= formRangeEndStr)
        .map((d) => d.date)
        .sort(),
    [openDates, todayStr, formRangeEndStr]
  );

  useEffect(() => {
    setForm((f) => {
      if (!f.date) return f;
      if (!dateOptions.includes(f.date)) {
        return { ...f, date: "", slot: "" };
      }
      return f;
    });
  }, [dateOptions]);
  const slotOptions = useMemo(
    () => openDates.find((d) => d.date === form.date)?.slots.map((slot) => slot.time) ?? [],
    [form.date, openDates]
  );

  /** 目前選取的時段是否為老師「額外開放」（長區間時需在備註填實際開始時間） */
  const selectedSlotSource = useMemo(() => {
    if (!form.date || !form.slot) return undefined;
    return openDates.find((d) => d.date === form.date)?.slots.find((s) => s.time === form.slot)?.source;
  }, [form.date, form.slot, openDates]);

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
        source: slot.source,
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
    if (selectedSlotSource === "extra" && !form.note.trim()) {
      setMessage("此時段為額外開放，請於「備註」填寫實際到場／開始討論的時間（例如 15:30）。");
      return;
    }
    setSaving(true);
    setMessage("");
    await createBooking(form);
    setBookings(await fetchBookings());
    setSelectedDate(form.date);
    const selected = new Date(`${form.date}T00:00:00`);
    setMonthCursor(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setForm((prev) => ({ ...EMPTY_FORM, date: prev.date }));
    setSaving(false);
    setMessage("預約成功！已完成登記。");
  }

  async function onDelete(id: string) {
    await deleteBooking(id);
    setBookings(await fetchBookings());
  }

  /** 老師刪除「額外開放」的某一時段（僅 teacherPatches 內標為 extra 者） */
  function removeTeacherExtraSlot(date: string, slotTime: string) {
    if (!syncReady) {
      setMessage("與試算表同步中，請稍候再試。");
      return;
    }
    const cnt = bookings.filter((b) => b.date === date && b.slot === slotTime).length;
    if (cnt > 0) {
      const ok = window.confirm(
        `此時段已有 ${cnt} 筆預約。刪除後時段將關閉，但既有預約紀錄仍保留；請視需要請同學改期或於後台刪除預約。確定刪除此額外時段？`
      );
      if (!ok) return;
    } else if (!window.confirm(`確定刪除 ${formatDateLabel(date)} 的額外時段 ${slotTime}？`)) {
      return;
    }
    teacherPatchesDirtyRef.current = true;
    setTeacherPatches((prev) => {
      const found = prev.find((item) => item.date === date);
      if (!found) return prev;
      const filtered = found.slots.filter((s) => !(s.source === "extra" && s.time === slotTime));
      if (filtered.length === 0) {
        return prev.filter((item) => item.date !== date);
      }
      return prev.map((item) =>
        item.date === date
          ? {
              ...item,
              slots: filtered,
              isExtraOpen: filtered.some((s) => s.source === "extra"),
            }
          : item
      );
    });
    setMessage(`已移除 ${formatDateLabel(date)} 的額外時段：${slotTime}`);
  }

  function mergeExtraSlots(date: string, slotTimes: string[]) {
    teacherPatchesDirtyRef.current = true;
    const newSlots = slotTimes.map((time) => ({ time, source: "extra" as const }));
    setTeacherPatches((prev) => {
      const found = prev.find((item) => item.date === date);
      if (!found) {
        return [...prev, { date, isExtraOpen: true, slots: newSlots }].sort((a, b) =>
          a.date.localeCompare(b.date)
        );
      }
      const merged = new Map(found.slots.map((slot) => [slot.time, slot]));
      for (const s of newSlots) merged.set(s.time, s);
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
  }

  function openAddSlotModal(date: string) {
    if (!syncReady) {
      setMessage("與試算表同步中，請稍候再新增時段。");
      return;
    }
    const holiday = isHoliday(date);
    if (holiday.isHoliday) {
      setMessage("國定假日不可新增開放時段。");
      return;
    }
    const start = "16:00";
    const end = coerceEndAfterStart(start, "17:00", teacherModalTimeChoices);
    setSlotStart(start);
    setSlotEnd(end);
    setAddSlotModal({ date });
  }

  function confirmAddSlotFromModal() {
    if (!addSlotModal) return;
    const { date } = addSlotModal;
    const endResolved = endChoices.includes(slotEnd) ? slotEnd : endChoices[0];
    if (!endResolved || timeToMinutes(endResolved) <= timeToMinutes(slotStart)) {
      setMessage("結束時間須晚於開始時間。");
      return;
    }
    const range = `${slotStart}-${endResolved}`;
    mergeExtraSlots(date, [range]);
    setAddSlotModal(null);
    setMessage(`已新增 ${formatDateLabel(date)} 時段：${range}`);
  }

  const endChoices = useMemo(
    () => endTimeOptionsAfter(slotStart, teacherModalTimeChoices),
    [slotStart, teacherModalTimeChoices]
  );

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-head">
          <h1>東明研TMLab討論預約系統</h1>
          <button
            type="button"
            className={`teacher-mode-btn ${teacherEditMode ? "on" : ""}`}
            onClick={() => setTeacherEditMode((v) => !v)}
          >
            {teacherEditMode ? "老師編輯模式：開啟" : "老師編輯模式：關閉"}
          </button>
        </div>
        <p>
          固定開放：週一 / 週四（16:00 後）・國定假日不開放・填寫後即預約成功・預設地點：3F
          研究室・表單日期僅列出「今日起」30 天內可預約日（可跨月）
        </p>
        <p>
          週一與週四以外時間請私訊老師確認是否額外開放，碩一以上要提報（口考）的同學，請自行注意討論的次數與研究進度
        </p>
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
            {selectedSlotSource === "extra" ? (
              <p className="form-hint-extra" role="note">
                此時段為老師額外開放，上方為可預約時間範圍；請於下方「備註」填寫實際到場／開始討論的時間（例如 15:30）。
              </p>
            ) : null}

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
                placeholder={
                  selectedSlotSource === "extra"
                    ? "【額外開放必填】請填寫實際到場／開始時間（例如 15:30）。可補充討論內容。預設地點 3F 研究室。"
                    : "可補充想討論的內容。預設地點為 3F 研究室。"
                }
                rows={4}
              />
            </label>

            <button type="submit" disabled={saving}>
              {saving ? "送出中..." : "確認送出預約"}
            </button>
            {message ? <p className="message">{message}</p> : null}
          </form>
        </section>

        <div className="calendar-panel-host">
        <section
          className="panel calendar-panel"
          aria-busy={!syncReady || calendarBackgroundSyncing}
        >
          <div className="calendar-panel-title">
            <h2>預約行事曆時段總覽</h2>
            {syncReady && calendarBackgroundSyncing ? (
              <span className="calendar-sync-inline" role="status" aria-live="polite">
                <span className="calendar-sync-spinner calendar-sync-spinner--sm" aria-hidden />
                後端同步中…
              </span>
            ) : null}
            <span
              className={`calendar-title-note ${teacherEditMode ? "on" : ""}`}
              aria-label={teacherEditMode ? "老師編輯模式：開啟後可編輯" : "僅供檢視"}
            >
              {teacherEditMode ? "老師編輯模式：開啟後可編輯" : "僅供檢視"}
            </span>
          </div>
          <div className="calendar-sync-body">
            {!syncReady ? (
              <div className="calendar-sync-overlay" role="status" aria-live="polite">
                <div className="calendar-sync-spinner" aria-hidden />
                <span>後端同步中…</span>
              </div>
            ) : null}
            <div className={!syncReady ? "calendar-sync-content calendar-sync-content--blocked" : "calendar-sync-content"}>
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

          <div className="month-calendar-viewport">
            <div className="month-calendar-inner">
              <div className="weekday-row">
                {getWeekdayHeaders().map((name) => (
                  <div key={name}>{name}</div>
                ))}
              </div>
              <div className="month-grid">
                {calendarData.map((day) => {
                  const inCurrentMonth =
                    monthCursor.getMonth() === new Date(`${day.date}T00:00:00`).getMonth();
                  const totalBookings = day.slots.reduce((acc, slot) => acc + slot.bookings.length, 0);
                  const canTeacherAdd = teacherEditMode && !day.isHoliday && day.slots.length === 0;
                  const isPast = isCalendarDateBeforeToday(day.date);
                  const hasOpenSlots = day.slots.length > 0 && !day.isHoliday;
                  const isBookableGreen = hasOpenSlots && !isPast;
                  return (
                    <article
                      key={day.date}
                      className={[
                        "month-cell",
                        !inCurrentMonth ? "outside" : "",
                        day.isHoliday ? "holiday" : "",
                        isPast ? "past" : "",
                        isBookableGreen ? "bookable-open" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
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
                                openAddSlotModal(day.date);
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
                          day.slots.length > 0 ? (
                            <p className="empty">尚無預約</p>
                          ) : null
                        ) : (
                          (() => {
                            const bubbleItems = day.slots
                              .filter((slot) => slot.bookings.length > 0)
                              .flatMap((slot) =>
                                slot.bookings.map((b) => ({ booking: b, slotTime: slot.time }))
                              );
                            const maxShow = 2;
                            const shown = bubbleItems.slice(0, maxShow);
                            const more = bubbleItems.length - shown.length;
                            return (
                              <div className="cell-booking-bubbles">
                                {shown.map(({ booking: b, slotTime }) => (
                                  <span
                                    key={b.id}
                                    className="booking-bubble"
                                    title={slotTime ? `${slotTime} · ${b.name}` : b.name}
                                  >
                                    <span className="booking-bubble-name">{b.name}</span>
                                  </span>
                                ))}
                                {more > 0 ? (
                                  <span className="booking-bubble booking-bubble-more" title={`另有 ${more} 人`}>
                                    ··· +{more}人
                                  </span>
                                ) : null}
                              </div>
                            );
                          })()
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
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
                      <div className="slot-time-row">
                        <div className="slot-time">{slot.time}</div>
                        {teacherEditMode && slot.source === "extra" ? (
                          <button
                            type="button"
                            className="remove-extra-slot-btn"
                            onClick={() => removeTeacherExtraSlot(selectedDateView.date, slot.time)}
                          >
                            刪除此額外時段
                          </button>
                        ) : null}
                      </div>
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
            </div>
          </div>
        </section>
        </div>
      </main>

      {addSlotModal ? (
        <div className="modal-backdrop" onClick={() => setAddSlotModal(null)} role="presentation">
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-slot-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="add-slot-title">新增開放時段</h3>
            <p className="modal-sub">{formatDateLabel(addSlotModal.date)}</p>

            <p className="modal-label">快速選擇</p>
            <div className="modal-presets">
              {TEACHER_SLOT_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="preset-chip"
                  onClick={() => {
                    setSlotStart(p.start);
                    setSlotEnd(p.end);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="modal-row modal-row-wheels">
              <div className="modal-field-wheel">
                <span className="modal-field-label">開始時間</span>
                <WheelTimeSelect
                  ariaLabel="開始時間"
                  options={teacherSlotStartChoices}
                  value={slotStart}
                  onChange={(s) => {
                    const ends = endTimeOptionsAfter(s, teacherModalTimeChoices);
                    setSlotStart(s);
                    setSlotEnd((prev) => (ends.includes(prev) ? prev : ends[0] ?? prev));
                  }}
                />
              </div>
              <div className="modal-field-wheel">
                <span className="modal-field-label">結束時間</span>
                <WheelTimeSelect
                  key={`end-${slotStart}-${endChoices[0] ?? ""}`}
                  ariaLabel="結束時間"
                  options={endChoices}
                  value={endChoices.includes(slotEnd) ? slotEnd : endChoices[0] ?? slotEnd}
                  onChange={setSlotEnd}
                  disabled={endChoices.length === 0}
                />
              </div>
            </div>
            <p className="modal-hint">
              將新增：{slotStart}–{endChoices.includes(slotEnd) ? slotEnd : endChoices[0] ?? "—"}
            </p>

            <div className="modal-actions">
              <button type="button" className="modal-btn secondary" onClick={() => setAddSlotModal(null)}>
                取消
              </button>
              <button
                type="button"
                className="modal-btn primary"
                onClick={confirmAddSlotFromModal}
                disabled={endChoices.length === 0}
              >
                確認新增
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
