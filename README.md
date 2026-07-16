# Talk Course Manager

給大專校院演講課使用的 Google Workspace 管理台。講者、場次、待辦與學期週曆放在課程自己的 Google Sheet，同校夥伴透過 Apps Script Web App 共同編輯。

[線上 Demo](https://cwstedctw.github.io/talk-course-manager/demo.html?demo=1)｜[課程設定精靈](https://cwstedctw.github.io/talk-course-manager/setup/)｜[安裝包](https://github.com/cwstedctw/talk-course-manager/releases)

> 目前版本：`v0.1.0-alpha.1`。程式、設定精靈與本機測試已可用；正式使用前，各校仍須完成 owner、editor、未授權帳號與網域外帳號的實機驗收。

## 這個版本能做什麼

- 同一個學校 Google Workspace 網域內，一位或多位 owner 搭配多位 editor。
- 以私有 Google Sheet 保存講者、場次、待辦、設定、稽核紀錄與復原紀錄。
- 用設定精靈調整學期起訖日、上課星期、時間、排除日與演講場次。
- 匯入 AI agent 產生的設定草稿；資料有缺漏時必須保留待確認標記。
- 用 revision、row version、`ScriptLock` 與 transaction journal 避免靜默覆蓋。
- 下載 JSON 備份。備份可能含講者聯絡資料，必須當成個資檔案保存。

這個 alpha 不支援一般 Gmail、跨校共同編輯、公開講者報名頁，也不包含任何學校專屬的領據、核銷或會計表單。

## 安裝

一般使用者建議下載 [最新安裝包](https://github.com/cwstedctw/talk-course-manager/releases)，解壓縮後把 `apps-script` 內的三個檔案放進一份空白 Google Sheet 的 Apps Script 專案。完整步驟見 [Workspace 安裝手冊](docs/INSTALL-WORKSPACE.md)。

開發者也可以從原始碼建置：

```bash
npm ci
npm run check
```

建置結果會放在 `dist/apps-script/` 與 `dist/pages/`。`dist/` 是產生檔，不要手動修改。

安裝時請守住一條界線：editor 只使用 Web App，不要把底層 Google Sheet 的編輯權分享給 editor。直接編輯 Sheet 會繞過角色驗證、資料驗證與 `AuditLog`。

## 權限

| 角色 | 可以做的事 |
|---|---|
| owner | 管理課程資料、設定與使用者 |
| editor | 編輯講者、場次與待辦 |
| denied | 不得取得課程資料 |

Google Workspace 網域限制是第一層，應用程式的 `Users` 白名單是第二層。權限判斷全部在 Apps Script 後端重做，不能只靠前端隱藏按鈕。

## 請 AI 幫忙設定

Codex、Claude Code 或其他 coding agent 應依序讀：

1. [`AGENTS.md`](AGENTS.md)
2. [`docs/AI-SETUP.md`](docs/AI-SETUP.md)
3. [`schemas/course-config.schema.json`](schemas/course-config.schema.json)

可以直接交給 agent 的提示：

```text
請先讀 AGENTS.md、docs/AI-SETUP.md 與 schemas/course-config.schema.json。
只查學校官方課程系統、官方行事曆與政府來源，建立
course.config.draft.json 與 course.sources.json。查不到就留空並列入
needsConfirmation，不要推測；不要部署 Apps Script，也不要修改 Google 權限。
```

AI 產出的內容只是草稿。設定精靈會在瀏覽器內驗證與預覽，教師確認後才匯出 `course.config.json`。

## 文件與原始碼

- [架構與角色](docs/ARCHITECTURE.md)
- [Workspace 安裝手冊](docs/INSTALL-WORKSPACE.md)
- [AI 設定與來源規則](docs/AI-SETUP.md)
- [隱私與安全邊界](docs/PRIVACY.md)
- [alpha 進度與驗收](docs/ROADMAP.md)
- `src/core/`：日期、排程與設定驗證
- `src/setup/`：靜態設定精靈
- `src/admin/`：管理台前端
- `src/gas-admin/`：Apps Script 後端

## 開發驗證

`npm run check` 會重建發布物、執行核心、schema、建置與 Apps Script 安全契約測試，再掃描不應公開的 Google ID、email、token 與私密檔案。目前共有 21 項自動測試；真正的 Workspace OAuth 與四種帳號權限仍需在目標學校環境人工驗收。

## 授權

程式碼採 [MIT License](LICENSE)。本工具不是任何學校的正式校務、個資或會計系統；各校仍須依自己的內部規範決定是否使用。
