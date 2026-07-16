# 同校 Google Workspace 安裝手冊

第一階段只支援同一個學校 Google Workspace 網域。安裝者需要能建立 Google Sheet、Apps Script Web App，且學校管理員沒有封鎖相關功能。

## 取得安裝檔

一般使用者：從 [Releases](https://github.com/cwstedctw/talk-course-manager/releases) 下載 `talk-course-manager-apps-script.zip` 並解壓縮。

開發者：在 repo 執行 `npm ci` 與 `npm run check`，使用 `dist/apps-script/` 的建置結果。

兩種方式都會得到：

- `Code.gs`：Apps Script 後端。
- `Index.html`：建置完成的管理台。
- `appsscript.json`：只允許同網域存取的 manifest。

## 建立 Apps Script 專案

1. 用學校 Google Workspace 帳號建立一份空白 Google Sheet。
2. 開啟「擴充功能 → Apps Script」。這必須是綁定該 Sheet 的 container-bound project。
3. 用安裝包的 `Code.gs` 取代編輯器裡的同名檔案。
4. 新增 HTML 檔，名稱填 `Index`，貼入 `Index.html` 的內容。
5. 到 Apps Script「專案設定」顯示 manifest，將 `appsscript.json` 換成安裝包內容。
6. 儲存專案，回到 Sheet 並重新整理。
7. 從「Talk Course Manager → 安裝／修復系統」執行安裝，依 Google 畫面由本人完成授權。

安裝完成後會建立七張工作表：`Users`、`Settings`、`Speakers`、`Talks`、`Tasks`、`AuditLog`、`Transactions`。第一位執行安裝的人會成為 owner。

## 部署 Web App

1. 回到 Apps Script，選「部署 → 新增部署 → 網頁應用程式」。
2. 執行身分選「我（部署者）」。
3. 存取權只選部署者所屬的 Workspace 網域，不要改成匿名或所有 Google 帳號。
4. 完成部署後，由 owner 開啟 Web App 網址。
5. 在管理台的「設定 → 使用者」加入同網域 editor。

editor 只使用 Web App。不要把底層 Google Sheet 分享成 editor 可直接編輯，否則會繞過角色、資料驗證與稽核紀錄。

## 匯入課程設定

1. 開啟[設定精靈](https://cwstedctw.github.io/talk-course-manager/setup/)。
2. 自行填寫，或匯入 AI 產生的 `course.config.draft.json`。
3. 核對週曆、排除日與演講場次後，勾選人工確認並下載 `course.config.json`。
4. 以 owner 身分進入管理台，在「設定 → 匯入課程設定」貼入 JSON。
5. 執行「權限健檢」。

設定精靈只在瀏覽器內處理資料，不會替使用者部署 Apps Script、寫入 Sheet 或按下 OAuth 同意。

## 上線前驗收

請用不同帳號逐一確認：

- owner 能管理課程、匯入設定與管理 `Users`。
- editor 能修改 Speakers、Talks、Tasks，但不能管理使用者或匯入設定。
- 同網域但不在 `Users` 的帳號無法取得 snapshot。
- 網域外帳號無法開啟部署。
- 兩個帳號同時修改同一筆資料時，舊 revision 或 version 會被拒絕。
- 新增一筆場次後重新整理，資料仍存在。
- `healthCheck()` 回報七張必要工作表、欄位與 active owner 都正常。

repo 的自動測試無法代替這一段。`Session.getActiveUser().getEmail()`、OAuth 與網域政策都必須在各校自己的 Workspace 實測。

## 不要放進 repo

- Google Sheet ID、Apps Script project ID、deployment ID。
- 學校或個人 email。
- OAuth token、API key。
- 真實講者、學生、課程或行政資料。

Sheet ID 會在安裝時寫入該 Apps Script 專案的 Script Properties，不需要手動貼進原始碼。
