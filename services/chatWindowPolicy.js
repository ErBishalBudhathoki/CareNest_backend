const CHAT_WINDOW_BUFFER_HOURS = 2;
const CHAT_WINDOW_BUFFER_MS = CHAT_WINDOW_BUFFER_HOURS * 60 * 60 * 1000;

const normalizeTimeString = (timeValue) => {
  const raw = (timeValue || '').toString().trim();
  if (!raw) return '00:00:00';
  if (/^\d{1}:\d{2}$/.test(raw)) return `0${raw}:00`;
  if (/^\d{2}:\d{2}$/.test(raw)) return `${raw}:00`;
  return raw;
};

const toShiftDateTime = (dateValue, timeValue) => {
  const dateStr = (dateValue || '').toString().trim();
  if (!dateStr) return null;

  const normalizedTime = normalizeTimeString(timeValue);
  const isoCandidate = `${dateStr}T${normalizedTime}`;
  const isoParsed = new Date(isoCandidate);

  if (!Number.isNaN(isoParsed.getTime())) {
    return isoParsed;
  }

  const fallback = new Date(`${dateStr} ${timeValue || ''}`);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
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
  const shiftEndAt = endAt instanceof Date ? endAt : new Date(endAt);
  if (Number.isNaN(shiftStartAt.getTime()) || Number.isNaN(shiftEndAt.getTime())) {
    return {
      isOpen: false,
      chatStartAt: null,
      chatEndAt: null,
      status: 'unavailable',
    };
  }

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
  normalizeTimeString,
  toShiftDateTime,
  buildChatWindow,
  isWithinChatWindow,
  getChatWindowClosedMessage,
};
