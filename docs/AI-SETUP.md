# AI agent 課程設定規格

## 任務

根據使用者提供的學校、課程、學期與官方來源，產生：

- `course.config.draft.json`
- `course.sources.json`

不得部署 Apps Script，不得修改 Google 權限。

## 搜尋規則

- 優先使用學校官方課程系統、官方行事曆與政府網站。
- 需要登入的內容不得繞過登入；請使用者提供檔案或留空。
- 國定假日不等於學校必然停課，以校方行事曆為準。
- 節次必須對照該校官方節次時間表，不得自行推算。
- 找不到的欄位留空並列入 `needsConfirmation`。
- 不得搜尋或寫入學生個資。
- 不得自動啟用核銷、領據或法律／行政 adapter。

## 來源格式

`course.sources.json` 每筆至少包含：

```json
{
  "field": "schedule.termStart",
  "url": "https://example.edu/calendar",
  "checkedAt": "2026-07-15",
  "status": "official_confirmed",
  "note": "官方學期行事曆"
}
```

允許狀態：

- `official_confirmed`
- `user_provided`
- `program_derived`
- `needs_confirmation`

## 標準提示

```text
請先讀 AGENTS.md、docs/AI-SETUP.md 與 schemas/course-config.schema.json。
搜尋指定學校與課程的官方課程資訊及行事曆，建立 course.config.draft.json
與 course.sources.json。查不到就留空，不得推測；只產生草稿，不部署、不改權限。
```

