const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parse an ISO calendar date without depending on the host time zone. */
export function parseIsoDate(value) {
  if (typeof value !== "string") return null;
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

export function formatIsoDate(date) {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function addDays(isoDate, days) {
  const date = parseIsoDate(isoDate);
  if (!date || !Number.isInteger(days)) {
    throw new TypeError("addDays requires an ISO date and an integer day count");
  }
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

export function weekdayOf(isoDate) {
  const date = parseIsoDate(isoDate);
  if (!date) throw new TypeError("weekdayOf requires a valid ISO date");
  return date.getUTCDay();
}

export function compareIsoDates(left, right) {
  const leftDate = parseIsoDate(left);
  const rightDate = parseIsoDate(right);
  if (!leftDate || !rightDate) {
    throw new TypeError("compareIsoDates requires valid ISO dates");
  }
  return leftDate.getTime() - rightDate.getTime();
}

export function parseTimeToMinutes(value) {
  if (typeof value !== "string") return null;
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
