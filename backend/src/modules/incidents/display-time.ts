// HH:mm in the display timezone, UTC+7, for MSG27 and MSG31.
const CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export const clockTime = (at: Date): string => CLOCK.format(at);
