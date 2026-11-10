export const LOCALE = "pt-BR";

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function parseDateString(value) {
  const stringValue = String(value || "").trim();
  if (!stringValue) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
    const [year, month, day] = stringValue.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  if (/^\d{4}-\d{2}$/.test(stringValue)) {
    const [year, month] = stringValue.split("-").map(Number);
    return new Date(year, month - 1, 1, 12, 0, 0, 0);
  }

  const parsed = new Date(stringValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value === "string") return parseDateString(value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function pad(number) {
  return String(number).padStart(2, "0");
}

export function dateKey(value = new Date()) {
  const date = toDate(value) ?? new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function monthKey(value = new Date()) {
  const date = toDate(value) ?? new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function toInputDateValue(value) {
  if (!value) return "";
  const stringValue = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) return stringValue;
  const date = toDate(value);
  return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : "";
}



export function startOfDay(value = new Date()) {
  const date = toDate(value) ?? new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function endOfDay(value = new Date()) {
  const date = toDate(value) ?? new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function startOfWeek(value = new Date()) {
  const date = startOfDay(value);
  const weekday = date.getDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  date.setDate(date.getDate() + diff);
  return date;
}

export function endOfWeek(value = new Date()) {
  const date = startOfWeek(value);
  date.setDate(date.getDate() + 6);
  return endOfDay(date);
}


function addCalendarDays(value, amount = 0) {
  const date = toDate(value) ?? new Date();
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function easterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function getBrazilianHolidays(year = new Date().getFullYear()) {
  const fixed = [
    { month: 1, day: 1, title: 'Confraternização Universal' },
    { month: 4, day: 21, title: 'Tiradentes' },
    { month: 5, day: 1, title: 'Dia do Trabalho' },
    { month: 9, day: 7, title: 'Independência do Brasil' },
    { month: 10, day: 12, title: 'Nossa Senhora Aparecida' },
    { month: 11, day: 2, title: 'Finados' },
    { month: 11, day: 15, title: 'Proclamação da República' },
    { month: 11, day: 20, title: 'Consciência Negra' },
    { month: 12, day: 25, title: 'Natal' },
  ].map((item) => ({
    id: `${year}-${pad(item.month)}-${pad(item.day)}`,
    date: `${year}-${pad(item.month)}-${pad(item.day)}`,
    title: item.title,
    type: 'Feriado nacional',
  }));

  const easter = easterDate(Number(year));
  const movable = [
    { offset: -48, title: 'Carnaval' },
    { offset: -47, title: 'Carnaval' },
    { offset: -46, title: 'Quarta-feira de Cinzas' },
    { offset: -2, title: 'Sexta-feira Santa' },
    { offset: 60, title: 'Corpus Christi' },
  ].map((item) => {
    const date = addCalendarDays(easter, item.offset);
    const key = dateKey(date);
    return { id: key, date: key, title: item.title, type: 'Feriado nacional' };
  });

  const byDate = new Map([...fixed, ...movable].map((item) => [item.date, item]));
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function isBrazilianHoliday(value) {
  const date = toDate(value);
  if (!date) return false;
  const key = dateKey(date);
  return getBrazilianHolidays(date.getFullYear()).some((item) => item.date === key);
}

export function isBusinessDay(value) {
  const date = toDate(value);
  if (!date) return false;
  const weekday = date.getDay();
  return weekday !== 0 && weekday !== 6 && !isBrazilianHoliday(date);
}

export function getNextBusinessDay(value) {
  let date = toDate(value) ?? new Date();
  date = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  while (!isBusinessDay(date)) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

export function dateFromMonthDay(month, day = 1) {
  const [year, monthNumber] = String(month || monthKey(new Date())).split('-').map(Number);
  const safeYear = Number.isFinite(year) ? year : new Date().getFullYear();
  const safeMonth = Number.isFinite(monthNumber) ? monthNumber : new Date().getMonth() + 1;
  const lastDay = new Date(safeYear, safeMonth, 0).getDate();
  const safeDay = Math.max(1, Math.min(lastDay, Number(day) || 1));
  return new Date(safeYear, safeMonth - 1, safeDay, 12, 0, 0, 0);
}

export function getAdjustedBusinessDateForMonthDay(month, day = 1) {
  return dateKey(getNextBusinessDay(dateFromMonthDay(month, day)));
}

export function formatDate(value, options = { dateStyle: "medium" }) {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(LOCALE, options).format(date).toUpperCase();
}





export function formatMonthLabel(date) {
  return formatDate(date, { month: "long", year: "numeric" });
}

export function formatCurrency(value = 0) {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

export function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function percentage(current = 0, total = 100) {
  const safeTotal = number(total, 0);
  if (safeTotal <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((number(current, 0) / safeTotal) * 100)));
}









export function isOverdue(value) {
  const date = toDate(value);
  if (!date) return false;
  return endOfDay(date) < startOfDay(new Date());
}

export function sumBy(list = [], selector = (item) => item) {
  return list.reduce((acc, item) => acc + number(selector(item), 0), 0);
}

export function sortByLatest(list = [], fields = ["updatedAt", "createdAt", "date", "dueDate"]) {
  return [...list].sort((a, b) => {
    const left = pickSortDate(a, fields);
    const right = pickSortDate(b, fields);
    return right - left;
  });
}

function pickSortDate(item, fields) {
  for (const field of fields) {
    const date = toDate(item?.[field]);
    if (date) return date.getTime();
  }
  return 0;
}







export function truncate(text = "", size = 120) {
  if (text.length <= size) return text;
  return `${text.slice(0, size).trim()}...`;
}

export function createIdPrefix(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}





export function formatMultilineText(value = "") {
  return escapeHtml(value).replaceAll("\n", "<br />");
}


export function stripHtml(value = '') {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

export function addDays(value = new Date(), amount = 0) {
  const date = toDate(value) || new Date();
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  copy.setDate(copy.getDate() + Number(amount || 0));
  return copy;
}

export function normalizeSearchText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function daysBetween(start, end) {
  const first = startOfDay(start);
  const last = startOfDay(end);
  return Math.round((last - first) / 86400000);
}

export function cleanObjectForWrite(record = {}) {
  const copy = { ...record };
  delete copy.id;
  delete copy.virtual;
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy;
}
