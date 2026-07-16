import test from "node:test";
import assert from "node:assert/strict";

import {
  assertCourseConfigSemantics,
  buildCourseSchedule,
  CourseConfigSemanticError,
  generateTalkSlots,
  generateWeeklyDates,
  parseIsoDate,
  validateCourseConfigSemantics,
} from "../src/core/index.mjs";

function config(overrides = {}) {
  return {
    schemaVersion: 1,
    organization: {
      schoolName: "範例大學",
      unitName: "範例中心",
      timeZone: "Asia/Taipei",
    },
    course: {
      name: "跨域專題演講",
      semester: "115-1",
      room: "教室 A",
      talkCount: 3,
      ...overrides.course,
    },
    schedule: {
      termStart: "2026-09-01",
      termEnd: "2026-09-30",
      weekday: 3,
      startTime: "14:00",
      endTime: "17:00",
      excludedDates: [],
      ...overrides.schedule,
    },
    features: { speakerLibrary: true, tasks: true, backup: true },
    needsConfirmation: [],
  };
}

function codes(issues) {
  return issues.map(({ code }) => code);
}

test("parseIsoDate rejects impossible calendar dates", () => {
  assert.ok(parseIsoDate("2028-02-29"));
  assert.equal(parseIsoDate("2027-02-29"), null);
  assert.equal(parseIsoDate("2026-13-01"), null);
  assert.equal(parseIsoDate("2026-9-01"), null);
});

test("generateWeeklyDates includes boundaries and works across calendar years", () => {
  assert.deepEqual(
    generateWeeklyDates({ termStart: "2026-12-30", termEnd: "2027-01-13", weekday: 3 }),
    ["2026-12-30", "2027-01-06", "2027-01-13"],
  );
});

test("generateWeeklyDates rejects invalid input before iterating", () => {
  assert.throws(
    () => generateWeeklyDates({ termStart: "2026-10-01", termEnd: "2026-09-01", weekday: 3 }),
    RangeError,
  );
  assert.throws(
    () => generateWeeklyDates({ termStart: "2026-09-01", termEnd: "2026-10-01", weekday: 7 }),
    RangeError,
  );
});

test("buildCourseSchedule removes excluded dates, adds makeups, sorts, and creates slots", () => {
  const result = buildCourseSchedule(
    config({
      schedule: {
        termStart: "2026-09-01",
        termEnd: "2026-09-30",
        weekday: 3,
        excludedDates: [{ date: "2026-09-09", reason: "停課" }],
      },
      course: { talkCount: 4 },
    }),
    { makeupDates: [{ date: "2026-09-12", reason: "補課" }] },
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.weeklyDates, [
    "2026-09-02",
    "2026-09-09",
    "2026-09-16",
    "2026-09-23",
    "2026-09-30",
  ]);
  assert.deepEqual(
    result.availableDates.map(({ date, source }) => [date, source]),
    [
      ["2026-09-02", "regular"],
      ["2026-09-12", "makeup"],
      ["2026-09-16", "regular"],
      ["2026-09-23", "regular"],
      ["2026-09-30", "regular"],
    ],
  );
  assert.deepEqual(result.talkSlots[1], {
    id: "talk-02",
    sequence: 2,
    date: "2026-09-12",
    startTime: "14:00",
    endTime: "17:00",
    durationMinutes: 180,
    source: "makeup",
    reason: "補課",
  });
  assert.equal(result.talkSlots.length, 4);
});

test("non-class-day exclusion is retained as a warning and does not remove a slot", () => {
  const result = buildCourseSchedule(
    config({ schedule: { excludedDates: [{ date: "2026-09-10", reason: "非上課日" }] } }),
  );
  assert.equal(result.valid, true);
  assert.deepEqual(codes(result.warnings), ["EXCLUDED_DATE_NOT_SCHEDULED"]);
  assert.equal(result.excludedDates.length, 0);
  assert.equal(result.availableDates.length, 5);
});

test("reports insufficient dates while returning every usable partial slot", () => {
  const result = buildCourseSchedule(
    config({
      course: { talkCount: 5 },
      schedule: {
        termStart: "2026-09-01",
        termEnd: "2026-09-16",
        excludedDates: [{ date: "2026-09-09", reason: "停課" }],
      },
    }),
  );
  const shortfall = result.errors.find(({ code }) => code === "INSUFFICIENT_TALK_SLOTS");
  assert.deepEqual({ requested: shortfall.requested, available: shortfall.available }, { requested: 5, available: 2 });
  assert.equal(result.talkSlots.length, 2);
  assert.equal(result.valid, false);
});

test("semantic validation catches reversed terms and invalid time ordering", () => {
  const result = validateCourseConfigSemantics(
    config({
      schedule: {
        termStart: "2026-10-01",
        termEnd: "2026-09-01",
        startTime: "17:00",
        endTime: "14:00",
      },
    }),
  );
  assert.equal(result.valid, false);
  assert.ok(codes(result.errors).includes("INVALID_TERM_RANGE"));
  assert.ok(codes(result.errors).includes("INVALID_TIME_RANGE"));
});

test("semantic validation catches malformed times and invalid talk counts", () => {
  const result = validateCourseConfigSemantics(
    config({ course: { talkCount: 0 }, schedule: { startTime: "9:00", endTime: "25:00" } }),
  );
  assert.ok(codes(result.errors).includes("INVALID_TIME_FORMAT"));
  assert.ok(codes(result.errors).includes("INVALID_TALK_COUNT"));
  assert.deepEqual(buildCourseSchedule(config({ schedule: { startTime: "17:00", endTime: "17:00" } })).talkSlots, []);
});

test("duplicate and conflicting schedule exceptions return stable error codes", () => {
  const result = buildCourseSchedule(
    config({
      schedule: {
        excludedDates: [
          { date: "2026-09-09", reason: "停課" },
          { date: "2026-09-09", reason: "重複" },
          { date: "2026-10-07", reason: "超出學期" },
        ],
      },
    }),
    {
      makeupDates: [
        { date: "2026-09-09", reason: "與排除日衝突" },
        { date: "2026-09-16", reason: "與固定上課日衝突" },
        { date: "2026-09-12", reason: "有效" },
        { date: "2026-09-12", reason: "重複" },
        { date: "2026-10-03", reason: "超出學期" },
      ],
    },
  );
  assert.deepEqual(codes(result.errors), [
    "DUPLICATE_EXCLUDED_DATE",
    "EXCLUDED_DATE_OUTSIDE_TERM",
    "MAKEUP_DATE_EXCLUDED",
    "MAKEUP_DATE_CONFLICT",
    "DUPLICATE_MAKEUP_DATE",
    "MAKEUP_DATE_OUTSIDE_TERM",
  ]);
  assert.deepEqual(result.makeupDates.map(({ date }) => date), ["2026-09-12"]);
});

test("invalid exception dates are reported without throwing", () => {
  const result = buildCourseSchedule(
    config({ schedule: { excludedDates: [{ date: "2026-02-30", reason: "錯誤日期" }] } }),
    { makeupDates: ["not-a-date"] },
  );
  assert.ok(codes(result.errors).includes("INVALID_EXCLUDED_DATE"));
  assert.ok(codes(result.errors).includes("INVALID_MAKEUP_DATE"));
});

test("generateTalkSlots is a convenience API and assertion exposes structured errors", () => {
  const validConfig = config({ course: { talkCount: 2 } });
  assert.deepEqual(generateTalkSlots(validConfig), buildCourseSchedule(validConfig).talkSlots);
  assert.doesNotThrow(() => assertCourseConfigSemantics(validConfig));

  assert.throws(
    () => assertCourseConfigSemantics(config({ schedule: { startTime: "18:00", endTime: "17:00" } })),
    (error) =>
      error instanceof CourseConfigSemanticError &&
      error.errors.some(({ code }) => code === "INVALID_TIME_RANGE"),
  );
});
