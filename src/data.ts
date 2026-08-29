import type { BookingRecord, StudentGroup, Topic } from "./types";

export const STUDENT_GROUPS: StudentGroup[] = [
  { label: "博班", students: ["侯政伯", "李岱融", "張意", "蔡松柏", "曾紫諾"] },
  { label: "日碩二", students: ["王瑜", "林芷瑩", "楊文騵"] },
  { label: "日碩一", students: ["褚允萱", "卓苡姍", "羅廣軒", "陳苡榛"] },
  { label: "職碩四", students: ["朱易晴", "張煥", "李泰頡"] },
  { label: "職碩三", students: ["何詩嬋", "蔡旻璇", "楊景惠", "邱苡甄", "李姍倪", "盧昱廷"] },
  { label: "職碩二", students: ["林倩如", "鄭力瑋", "謝芳芳", "詹睿騰"] },
  { label: "職碩一", students: ["張筱蓓", "龐甄嬉", "顏慈君"] },
  { label: "交換未離校", students: ["趙怡捷", "朱容愷"] },
  { label: "其他", students: ["大學部 / 已畢業 / 外部"] },
];

export const TOPIC_OPTIONS: Topic[] = ["計劃執行", "生涯", "純聊天", "碩博論", "研討會或期刊", "設計或競賽", "其他備註"];

export const DURATION_OPTIONS = [10, 20, 30, 60, 90, 120];

/** 週一／週四固定開放：一小時一區間（最晚 19:00–20:00） */
export const FIXED_TIME_SLOTS = [
  "16:00-17:00",
  "17:00-18:00",
  "18:00-19:00",
  "19:00-20:00",
];

// 預設不放額外開放日，僅由老師在月曆以 + 新增。
export const EXTRA_OPEN_DATES: Array<{ date: string; slots: string[] }> = [];

export const HOLIDAYS: Array<{ date: string; name: string }> = [
  { date: "2026-04-06", name: "清明節補假" },
  { date: "2026-05-01", name: "勞動節" },
];

export const INITIAL_BOOKINGS: BookingRecord[] = [
  {
    id: "b1",
    timestamp: "2026-04-03T09:20:00.000Z",
    name: "王瑜",
    date: "2026-04-09",
    slot: "16:00-17:00",
    duration: 30,
    topics: ["碩博論"],
    note: "想討論論文架構與研究方法。",
  },
  {
    id: "b2",
    timestamp: "2026-04-03T10:30:00.000Z",
    name: "侯政伯",
    date: "2026-04-09",
    slot: "17:00-18:00",
    duration: 20,
    topics: ["研討會或期刊", "計劃執行"],
    note: "",
  },
  {
    id: "b3",
    timestamp: "2026-04-04T08:50:00.000Z",
    name: "曾紫諾",
    date: "2026-04-13",
    slot: "18:00-19:00",
    duration: 60,
    topics: ["生涯"],
    note: "想聊研究職涯與投稿規劃。",
  },
];
