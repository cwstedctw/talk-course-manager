import {
  addDays,
  compareIsoDates,
  parseIsoDate,
  parseTimeToMinutes,
  weekdayOf,
} from "./date.mjs";

function issue(code, path, message, details = {}) {
  return { code, path, message, ...details };
}

function dateEntry(value) {
  if (typeof value === "string") return { date: value, reason: "" };
  if (value && typeof value === "object") {
    return {
      date: value.date,
      reason: typeof value.reason === "string" ? value.reason : "",
    };
  }
  return { date: undefined, reason: "" };
}

/**
 * Generate all occurrences of weekday between termStart and termEnd, inclusive.
 * weekday follows JavaScript convention: 0 = Sunday, 6 = Saturday.
 */
export function generateWeeklyDates({ termStart, termEnd, weekday }) {
  if (!parseIsoDate(termStart) || !parseIsoDate(termEnd)) {
    throw new TypeError("termStart and termEnd must be valid ISO dates");
  }
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new RangeError("weekday must be an integer from 0 through 6");
  }
  if (compareIsoDates(termStart, termEnd) > 0) {
    throw new RangeError("termStart must not be later than termEnd");
  }

  const offset = (weekday - weekdayOf(termStart) + 7) % 7;
  const first = addDays(termStart, offset);
  const dates = [];
  for (let date = first; compareIsoDates(date, termEnd) <= 0; date = addDays(date, 7)) {
    dates.push(date);
  }
  return dates;
}

/**
 * Build a deterministic schedule. `makeupDates` is deployment input rather than
 * part of the portable v1 config schema; it accepts ISO strings or
 * `{ date, reason }` objects.
 */
export function buildCourseSchedule(config, { makeupDates = [] } = {}) {
  const errors = [];
  const warnings = [];
  const schedule = config?.schedule ?? {};
  const talkCount = config?.course?.talkCount;

  const startDateValid = Boolean(parseIsoDate(schedule.termStart));
  const endDateValid = Boolean(parseIsoDate(schedule.termEnd));
  const weekdayValid =
    Number.isInteger(schedule.weekday) && schedule.weekday >= 0 && schedule.weekday <= 6;
  const startMinutes = parseTimeToMinutes(schedule.startTime);
  const endMinutes = parseTimeToMinutes(schedule.endTime);
  const timeValid = startMinutes !== null && endMinutes !== null;
  const talkCountValid = Number.isInteger(talkCount) && talkCount > 0;

  if (!startDateValid) {
    errors.push(issue("INVALID_TERM_START", "schedule.termStart", "termStart 必須是有效的 YYYY-MM-DD 日期。"));
  }
  if (!endDateValid) {
    errors.push(issue("INVALID_TERM_END", "schedule.termEnd", "termEnd 必須是有效的 YYYY-MM-DD 日期。"));
  }
  if (startDateValid && endDateValid && compareIsoDates(schedule.termStart, schedule.termEnd) > 0) {
    errors.push(issue("INVALID_TERM_RANGE", "schedule.termEnd", "termEnd 不得早於 termStart。"));
  }
  if (!weekdayValid) {
    errors.push(issue("INVALID_WEEKDAY", "schedule.weekday", "weekday 必須是 0 到 6 的整數。"));
  }
  if (!timeValid) {
    errors.push(issue("INVALID_TIME_FORMAT", "schedule", "startTime 與 endTime 必須使用 24 小時 HH:MM 格式。"));
  } else if (startMinutes >= endMinutes) {
    errors.push(issue("INVALID_TIME_RANGE", "schedule.endTime", "endTime 必須晚於 startTime。"));
  }
  if (!talkCountValid) {
    errors.push(issue("INVALID_TALK_COUNT", "course.talkCount", "talkCount 必須是大於 0 的整數。"));
  }

  const termRangeValid =
    startDateValid &&
    endDateValid &&
    compareIsoDates(schedule.termStart, schedule.termEnd) <= 0;
  const weeklyDates = termRangeValid && weekdayValid ? generateWeeklyDates(schedule) : [];
  const weeklySet = new Set(weeklyDates);

  const exclusionInput = Array.isArray(schedule.excludedDates) ? schedule.excludedDates : [];
  const excludedSet = new Set();
  const excludedDates = [];
  const seenExcluded = new Set();

  exclusionInput.forEach((rawEntry, index) => {
    const entry = dateEntry(rawEntry);
    const path = `schedule.excludedDates[${index}].date`;
    if (!parseIsoDate(entry.date)) {
      errors.push(issue("INVALID_EXCLUDED_DATE", path, "排除日必須是有效的 YYYY-MM-DD 日期。"));
      return;
    }
    if (seenExcluded.has(entry.date)) {
      errors.push(issue("DUPLICATE_EXCLUDED_DATE", path, "排除日不可重複。", { date: entry.date }));
      return;
    }
    seenExcluded.add(entry.date);

    if (
      termRangeValid &&
      (compareIsoDates(entry.date, schedule.termStart) < 0 ||
        compareIsoDates(entry.date, schedule.termEnd) > 0)
    ) {
      errors.push(issue("EXCLUDED_DATE_OUTSIDE_TERM", path, "排除日必須位於學期範圍內。", { date: entry.date }));
      return;
    }
    if (!weeklySet.has(entry.date)) {
      warnings.push(issue("EXCLUDED_DATE_NOT_SCHEDULED", path, "此排除日原本不是每週上課日，不會影響排程。", { date: entry.date }));
      return;
    }
    excludedSet.add(entry.date);
    excludedDates.push(entry);
  });

  const regularEntries = weeklyDates
    .filter((date) => !excludedSet.has(date))
    .map((date) => ({ date, source: "regular", reason: "" }));
  const occupiedDates = new Set(regularEntries.map(({ date }) => date));
  const makeupEntries = [];
  const seenMakeup = new Set();
  const normalizedMakeups = Array.isArray(makeupDates) ? makeupDates : [];

  normalizedMakeups.forEach((rawEntry, index) => {
    const entry = dateEntry(rawEntry);
    const path = `makeupDates[${index}].date`;
    if (!parseIsoDate(entry.date)) {
      errors.push(issue("INVALID_MAKEUP_DATE", path, "補課日必須是有效的 YYYY-MM-DD 日期。"));
      return;
    }
    if (seenMakeup.has(entry.date)) {
      errors.push(issue("DUPLICATE_MAKEUP_DATE", path, "補課日不可重複。", { date: entry.date }));
      return;
    }
    seenMakeup.add(entry.date);

    if (
      termRangeValid &&
      (compareIsoDates(entry.date, schedule.termStart) < 0 ||
        compareIsoDates(entry.date, schedule.termEnd) > 0)
    ) {
      errors.push(issue("MAKEUP_DATE_OUTSIDE_TERM", path, "補課日必須位於學期範圍內。", { date: entry.date }));
      return;
    }
    if (excludedSet.has(entry.date)) {
      errors.push(issue("MAKEUP_DATE_EXCLUDED", path, "同一日期不可同時是排除日與補課日。", { date: entry.date }));
      return;
    }
    if (occupiedDates.has(entry.date)) {
      errors.push(issue("MAKEUP_DATE_CONFLICT", path, "補課日與既有上課日重複。", { date: entry.date }));
      return;
    }

    occupiedDates.add(entry.date);
    makeupEntries.push({ ...entry, source: "makeup" });
  });

  const availableDates = [...regularEntries, ...makeupEntries].sort((left, right) =>
    compareIsoDates(left.date, right.date),
  );

  if (talkCountValid && talkCount > availableDates.length) {
    errors.push(
      issue(
        "INSUFFICIENT_TALK_SLOTS",
        "course.talkCount",
        `需要 ${talkCount} 場，但排程只有 ${availableDates.length} 個可用日期。`,
        { requested: talkCount, available: availableDates.length },
      ),
    );
  }

  const usableTime = timeValid && startMinutes < endMinutes;
  const selectedDates = talkCountValid ? availableDates.slice(0, talkCount) : [];
  const talkSlots = usableTime
    ? selectedDates.map((entry, index) => ({
        id: `talk-${String(index + 1).padStart(2, "0")}`,
        sequence: index + 1,
        date: entry.date,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        durationMinutes: endMinutes - startMinutes,
        source: entry.source,
        reason: entry.reason,
      }))
    : [];

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    weeklyDates,
    excludedDates,
    makeupDates: makeupEntries,
    availableDates,
    talkSlots,
  };
}

export function generateTalkSlots(config, options) {
  return buildCourseSchedule(config, options).talkSlots;
}
