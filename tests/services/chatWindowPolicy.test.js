const {
  buildChatWindow,
  isWithinChatWindow,
  toShiftDateTime,
} = require('../../services/chatWindowPolicy');

describe('chatWindowPolicy', () => {
  test('opens 2 hours before shift start and closes 2 hours after shift end', () => {
    const shiftStart = new Date('2026-03-01T10:00:00.000Z');
    const shiftEnd = new Date('2026-03-01T12:00:00.000Z');

    const oneMinuteBeforeOpen = new Date('2026-03-01T07:59:00.000Z');
    const insideEarlyWindow = new Date('2026-03-01T08:01:00.000Z');
    const insideLateWindow = new Date('2026-03-01T13:59:00.000Z');
    const oneMinuteAfterClose = new Date('2026-03-01T14:01:00.000Z');

    expect(
      isWithinChatWindow({
        startAt: shiftStart,
        endAt: shiftEnd,
        now: oneMinuteBeforeOpen,
      })
    ).toBe(false);

    expect(
      isWithinChatWindow({
        startAt: shiftStart,
        endAt: shiftEnd,
        now: insideEarlyWindow,
      })
    ).toBe(true);

    expect(
      isWithinChatWindow({
        startAt: shiftStart,
        endAt: shiftEnd,
        now: insideLateWindow,
      })
    ).toBe(true);

    expect(
      isWithinChatWindow({
        startAt: shiftStart,
        endAt: shiftEnd,
        now: oneMinuteAfterClose,
      })
    ).toBe(false);
  });

  test('buildChatWindow returns unavailable when shift window is missing', () => {
    const result = buildChatWindow({
      startAt: null,
      endAt: null,
      now: new Date('2026-03-01T10:00:00.000Z'),
    });

    expect(result.isOpen).toBe(false);
    expect(result.status).toBe('unavailable');
    expect(result.chatStartAt).toBeNull();
    expect(result.chatEndAt).toBeNull();
  });

  test('toShiftDateTime parses schedule date/time strings', () => {
    const parsed = toShiftDateTime('2026-03-01', '09:30');
    expect(parsed).toBeInstanceOf(Date);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(parsed.getUTCFullYear()).toBe(2026);
  });
});
