import { buildCourseSchedule } from "./schedule.mjs";

/**
 * Validate relationships that JSON Schema cannot express. Run schema validation
 * first; this function covers date ranges, time ordering, duplicate/conflicting
 * exceptions and whether the requested number of talks can fit.
 */
export function validateCourseConfigSemantics(config, options) {
  const result = buildCourseSchedule(config, options);
  return {
    valid: result.valid,
    errors: result.errors,
    warnings: result.warnings,
  };
}

export class CourseConfigSemanticError extends Error {
  constructor(errors) {
    super(`課程設定有 ${errors.length} 個語意錯誤。`);
    this.name = "CourseConfigSemanticError";
    this.errors = errors;
  }
}

export function assertCourseConfigSemantics(config, options) {
  const result = validateCourseConfigSemantics(config, options);
  if (!result.valid) throw new CourseConfigSemanticError(result.errors);
  return result;
}
