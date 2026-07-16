import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schema = JSON.parse(await readFile(new URL('../schemas/course-config.schema.json', import.meta.url), 'utf8'));
const example = JSON.parse(await readFile(new URL('../examples/university-course.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

test('公開範例符合 course config schema', () => {
  assert.equal(validate(example), true, JSON.stringify(validate.errors));
});

test('schema 拒絕未知欄位與錯誤時間格式', () => {
  const bad = structuredClone(example);
  bad.organization.secret = '不可落地';
  bad.schedule.startTime = '9:00';
  assert.equal(validate(bad), false);
  const keywords = validate.errors.map((error) => error.keyword);
  assert.ok(keywords.includes('additionalProperties'));
  assert.ok(keywords.includes('pattern'));
});
