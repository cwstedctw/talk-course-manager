# AGENTS.md

## 專案目標

建立可供其他大專校院使用的 Talk Course Manager。第一階段只支援同校 Google Workspace 多人協作。

## 工作規則

- 先讀 `README.md`、`docs/ARCHITECTURE.md` 與本檔。
- 只修改 `src/`、`schemas/`、`examples/`、`docs/`、`tests/` 與建置工具。
- `dist/` 是建置產物，不得手動修改。
- 不得從原始私有專案直接複製部署 ID、Sheet ID、email、真實講者資料、推薦名單或學校專屬經費資料。
- 一般版不得包含特定機構網域、校內行政連結或現行課程真值。
- 未知設定值必須留空或標成 `needs_confirmation`，不得推測。
- AI 搜尋只使用官方學校、政府或使用者提供的來源。
- 不得代使用者按下 Google OAuth 同意、公開部署或權限變更。

## 設定生命週期

```text
設定頁／AI
  → course.config.draft.json + course.sources.json
  → schema 與語意驗證
  → 使用者確認
  → course.config.json
  → 安裝至 Google Sheet Settings
```

正式上線後以 Sheet `Settings` 為唯一真值；JSON 只作為安裝輸入、匯出快照或新學期範本。

## 第一階段權限契約

- `access = DOMAIN`
- `executeAs = USER_DEPLOYING`
- 只有 `Users` 表中的 owner/editor 能取得資料。
- 同網域但不在白名單者必須被伺服器端拒絕。
- 網域外帳號必須被 Google 部署層拒絕。
- owner 初始化完成前，不得進入正式管理台。

## 驗證要求

每次修改至少檢查：

- 設定 schema 驗證
- 排程跨年度、排除日、重複日期與場次不足
- owner、editor、同網域未授權者、網域外帳號
- 重新整理後資料仍存在
- general build 不含真實 email、Google 資源 ID 或學校專屬資料
