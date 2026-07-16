# Core

此目錄提供與 UI、Google 權限及儲存層無關的純 ES modules，可在 Node 與現代瀏覽器使用。

```js
import {
  buildCourseSchedule,
  generateWeeklyDates,
  validateCourseConfigSemantics,
} from "./src/core/index.mjs";
```

主要 API：

- `generateWeeklyDates(schedule)`：依學期起訖日與星期產生每週日期。
- `buildCourseSchedule(config, { makeupDates })`：套用排除日、補課日並產生演講場次。
- `validateCourseConfigSemantics(config, options)`：檢查 schema 無法表達的日期、時間、衝突與場次容量。
- `assertCourseConfigSemantics(config, options)`：驗證失敗時丟出 `CourseConfigSemanticError`。

`makeupDates` 接受 ISO 日期字串或 `{ date, reason }`；它是安裝／排程輸入，不屬於 v1 可攜式設定 schema。所有日期均使用 UTC civil-date 算法，結果不受執行環境時區或日光節約時間影響。

第一階段不得包含任何學校專屬表單、經費或部署資訊。
