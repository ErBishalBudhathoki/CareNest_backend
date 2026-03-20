const CHAT_WINDOW_BUFFER_HOURS = 2;
const CHAT_WINDOW_BUFFER_MS = CHAT_WINDOW_BUFFER_HOURS * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ENFORCE_SHIFT_CHAT_WINDOW = process.env.ENFORCE_SHIFT_CHAT_WINDOW === 'true';

const normalizeTimeString = (timeValue) => {
  const raw = (timeValue || '').toString().trim();
  if (!raw) return '00:00:00';
  if (/^\d{1}:\d{2}$/.test(raw)) return `0${raw}:00`;
  if (/^\d{2}:\d{2}$/.test(raw)) return `${raw}:00`;
  return raw;
};

const parseDateOnly = (dateValue) => {
  if (!dateValue) return null;

  if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
    return new Date(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate());
  }

  const raw = dateValue.toString().trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]) - 1;
    const day = Number(isoMatch[3]);
    return new Date(year, month, day);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const parseTimeParts = (timeValue) => {
  if (timeValue == null) {
    return { hour: 0, minute: 0, second: 0 };
  }

  if (timeValue instanceof Date && !Number.isNaN(timeValue.getTime())) {
    return {
      hour: timeValue.getHours(),
      minute: timeValue.getMinutes(),
      second: timeValue.getSeconds(),
    };
  }

  const raw = timeValue.toString().trim();
  if (!raw) {
    return { hour: 0, minute: 0, second: 0 };
  }

  if (/^\d{4}-\d{1,2}-\d{1,2}[T\s]/.test(raw)) {
    const absoluteTime = new Date(raw);
    if (!Number.isNaN(absoluteTime.getTime())) {
      return {
        hour: absoluteTime.getHours(),
        minute: absoluteTime.getMinutes(),
        second: absoluteTime.getSeconds(),
      };
    }
  }

  const normalized = raw.replace(/\s+/g, ' ').toUpperCase();
  const match = normalized.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  const meridiem = match[4] || null;

  if (meridiem) {
    if (hour === 12) hour = 0;
    if (meridiem === 'PM') hour += 12;
  }

  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  return { hour, minute, second };
};

const toShiftDateTime = (dateValue, timeValue) => {
  if (typeof timeValue === 'string') {
    const absoluteRaw = timeValue.trim();
    if (/^\d{4}-\d{1,2}-\d{1,2}[T\s]/.test(absoluteRaw)) {
      const absoluteParsed = new Date(absoluteRaw);
      if (!Number.isNaN(absoluteParsed.getTime())) {
        return absoluteParsed;
      }
    }
  }

  const dateOnly = parseDateOnly(dateValue);
  if (!dateOnly) return null;

  const timeParts = parseTimeParts(timeValue);
  if (!timeParts) return null;

  return new Date(
    dateOnly.getFullYear(),
    dateOnly.getMonth(),
    dateOnly.getDate(),
    timeParts.hour,
    timeParts.minute,
    timeParts.second
  );
};

const buildChatWindow = ({ startAt, endAt, now = new Date() }) => {
  if (!startAt || !endAt) {
    return {
      isOpen: false,
      chatStartAt: null,
      chatEndAt: null,
      status: 'unavailable',
    };
  }

  const shiftStartAt = startAt instanceof Date ? startAt : new Date(startAt);
  const shiftEndCandidate = endAt instanceof Date ? endAt : new Date(endAt);
  if (Number.isNaN(shiftStartAt.getTime()) || Number.isNaN(shiftEndCandidate.getTime())) {
    return {
      isOpen: false,
      chatStartAt: null,
      chatEndAt: null,
      status: 'unavailable',
    };
  }

  const shiftEndAt =
    shiftEndCandidate.getTime() <= shiftStartAt.getTime()
      ? new Date(shiftEndCandidate.getTime() + DAY_MS)
      : shiftEndCandidate;

  const chatStartAt = new Date(shiftStartAt.getTime() - CHAT_WINDOW_BUFFER_MS);
  const chatEndAt = new Date(shiftEndAt.getTime() + CHAT_WINDOW_BUFFER_MS);
  const nowDate = now instanceof Date ? now : new Date(now);

  const isOpen = nowDate >= chatStartAt && nowDate <= chatEndAt;
  const status = isOpen ? 'open' : nowDate < chatStartAt ? 'upcoming' : 'closed';

  return {
    isOpen,
    chatStartAt,
    chatEndAt,
    status,
  };
};

const isWithinChatWindow = ({ startAt, endAt, now = new Date() }) =>
  buildChatWindow({ startAt, endAt, now }).isOpen;

const getChatWindowClosedMessage = () =>
  'Messaging is only available from 2 hours before shift start until 2 hours after shift end.';

module.exports = {
  CHAT_WINDOW_BUFFER_HOURS,
  CHAT_WINDOW_BUFFER_MS,
  ENFORCE_SHIFT_CHAT_WINDOW,
  normalizeTimeString,
  toShiftDateTime,
  buildChatWindow,
  isWithinChatWindow,
  getChatWindowClosedMessage,
};
