# Talk Course Manager

給大專校院教師管理多場校外講者演講的 Google Workspace 工作台。

> 目前狀態：`v0.1.0-alpha` 規劃與通用化施工中，尚未提供正式安裝包。

## 第一階段支援範圍

本階段只支援：

- 同一所學校、同一個 Google Workspace 網域
- 一位課程 owner 與多位 editor
- 私有 Google Sheet 作為正式資料來源
- Google Apps Script 私有管理台
- 講者庫、場次、彈性週曆、自動待辦與備份

暫不支援：

- 跨學校或一般 Gmail 多人協作
- 公開講者報名頁
- 任何學校專屬的領據、核銷或會計表單
- 內建 AI API 或自動部署 Apps Script

## 預定使用流程

1. 複製 Google Sheet 範本。
2. 開啟設定精靈。
3. 自行填寫，或匯入 AI agent 產生的課程設定草稿。
4. 預覽上課日期、排除日期與演講場次。
5. 由安裝者建立第一位 owner。
6. 以「同一網域」權限部署管理台。
7. 新增同網域 editor，完成內建健檢。

## 資料放在哪裡

- 正式課程資料：安裝者自己的私有 Google Sheet。
- 瀏覽器：只保存離線草稿與待同步佇列。
- GitHub：只保存程式碼、空白範例與文件，不保存講者聯絡資料。

## AI agent

Codex、Claude Code 或其他 coding agent 應先讀：

1. [`AGENTS.md`](AGENTS.md)
2. [`docs/AI-SETUP.md`](docs/AI-SETUP.md)
3. [`schemas/course-config.schema.json`](schemas/course-config.schema.json)

AI 只能產生設定草稿，不能自行部署、授權或把無法查證的資料寫成已確認。

## 文件

- [公開版架構](docs/ARCHITECTURE.md)
- [第一階段施工計畫](docs/ROADMAP.md)
- [Workspace 安裝規格](docs/INSTALL-WORKSPACE.md)
- [AI 設定規格](docs/AI-SETUP.md)
- [隱私與安全邊界](docs/PRIVACY.md)

## 開源狀態

公開發布前仍須由專案擁有者選定授權條款。授權完成前，請勿把本 alpha 當成已授權的公開套件散布。

