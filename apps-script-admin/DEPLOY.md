# 部署手冊（專案 A：私有管理台）

> 本資料夾是私有管理台 Apps Script 專案。`Code.gs` 不保存試算表 ID；執行時只讀 Apps Script 的 `SHEET_ID` 指令碼屬性。缺漏或格式錯誤會停止，不會退回範例資料。專案 A（私有管理台）與專案 B（公開報名端點）分開部署，是為了避免一次部署設定錯誤就把私有管理台對外開放。

## 0. 建立你自己的 Apps Script 專案

1. 安裝並登入 clasp：`npm install -g @google/clasp`，然後 `clasp login`。
2. 二選一：
   - **全新建立**：在本資料夾執行 `clasp create --type webapp --title "演講課管理台"`，clasp 會自動產生 `.clasp.json`。
   - **已有專案**：把 `.clasp.json.example` 複製成 `.clasp.json`，將 `scriptId` 換成你自己的專案 ID（Apps Script 編輯器「專案設定」頁可查）。
3. `.clasp.json` 內含你的 scriptId，建議不要 commit 進公開 repo（本 repo 的 `.gitignore` 已擋）。

## 1. 準備乾淨 production Sheet

1. 用部署擁有者的學校（或個人）帳號新增一份私有 Google 試算表，例如「演講課管理台（正式）」。
2. 從網址複製 Sheet ID，但不要貼進 repo、issue 或部署文件。
3. 分別到專案 A 與專案 B 的「專案設定 → 指令碼屬性」，新增 `SHEET_ID`，兩邊填同一個 production Sheet ID。
4. 不要執行 `seedFakeData()`；正式初始化只用 `bootstrapProduction()`。

建議另保留 dev Sheet 跑測試。`runW1Suite()`、`runV2CompletionSuite()` 會建立測試資料／`TestResults`，不要直接在正式 Sheet 執行。Script Properties 是整個 Apps Script 專案共用，不隨 deployment 版本切換；同一專案的 `/dev` 與所有讀取屬性的部署會一起指向同一份 Sheet。若要長期同時保留 staging 與 production，必須使用不同 Apps Script 專案。

正式 Apps Script 專案的 Script Properties 必須沒有 `ALLOW_DESTRUCTIVE_TESTS`，或值不是 `true`。這道閘會阻擋測試種子、測試套件與明確覆寫既有經費科目；不要為了方便在 production 開啟。

## 2. 推送程式

```powershell
cd <本資料夾>
clasp status
clasp push -f
```

確認推送目標是專案 A（管理台），不是報名端點的 scriptId。再到 Apps Script 編輯器執行一次不帶參數的 `bootstrapProduction()`。以示範經費表（合計 300,000）為例，預期回傳：

- `ok: true`
- `owner` 是部署擁有者的 email
- `budgetLineCount: 12`
- `budgetTotal: 300000`（若你已照自己的核定經費表改 `officialBudgetLines_()`，這裡等於你的核定總額）

它只建立 schema、Owner、schemaVersion 與經費科目，不會建立假講者、假場次或假報名。重跑時預設保留已存在的經費科目；`{overwriteExisting:true}` 會重設資料，只允許在已開啟破壞性測試閘的 dev／staging 使用，production 不得執行。

需要 Editor 時，在正式 Sheet 的 `Users` 分頁新增一列；`role` 只能是 `owner` 或 `editor`。同網域不等於已授權，只有 Users allowlist 的帳號能讀資料。

## 3. 部署目前版本

首次部署或安全設定有變更時：

1. Apps Script 編輯器右上「部署」→「新增部署作業」→「網頁應用程式」。
2. 確認：
   - 執行身分：**我**
   - 具有存取權的使用者：**你的學校 Workspace 網域**（用個人 Gmail 部署時改選「只有我自己」，見 SETUP.md 第 8 步）
3. 按「部署」並完成 OAuth；目前只需要試算表與登入 email 權限，**不需要 Drive／Gmail scope**。
4. 記下 deploymentId、Web App URL、版本、executeAs 與 access（存在你自己的私人筆記，不進公開 repo）。

既有部署更新可用 `clasp deploy -i <deploymentId>` 保持網址不變，但更新後仍要到部署管理頁確認安全設定沒有變動。

若同一個管理台 deployment 要從 dev Sheet 切到 production Sheet，切換前先請每位 Owner／Editor 確認右上角「已同步」，或明確捨棄尚未同步的本機草稿。新版會用 `dataStoreKey` 自動隔離不同 Sheet 與帳號的快取，舊後端若未回這個鍵則停止開啟；不要手動複製 localStorage 到新環境。設定 `SHEET_ID` 後先用 HEAD 驗證，再更新既有正式 deployment，縮短管理台與公開端點指向不同環境的時間。

## 4. 驗收

依序使用三種真實帳號：

- Owner：可讀寫日常資料與 Settings。
- Editor：可管理講者、場次、待辦、核銷、經費與報名；看不到 Users／AuditLog，不能改 Settings。
- 同網域但不在 Users 的帳號：停在拒絕畫面，拿不到伺服器資料，也不得開啟前一位使用者草稿。

以下完整破壞性／造資料驗收只在 dev／staging 或可丟棄的 production 副本完成，**不要在正式使用中的 Sheet 執行 `runV2CompletionSuite()` 或建立整套假場次**：

0. 只在 dev／staging 的 Apps Script「專案設定 → 指令碼屬性」暫時設 `ALLOW_DESTRUCTIVE_TESTS=true`，執行 `runW1Suite()` 與 `runV2CompletionSuite()`；跑完立刻刪除該屬性或改成非 `true`，再確認測試函式會被拒絕。

1. Owner／Editor 同時改同一場日期，確認後送者看到衝突。
2. 已登入後斷網輸入，再連線，確認先 pull 成功才 push；輸入框仍聚焦時，45 秒輪詢不得重畫吃掉尚未失焦的文字。
3. 公開報名送出一筆，在管理台「報名」轉入；再送一筆並「略過」。
4. 走完整 E2E：講者 → 場次 → 待辦 → 文件 → 核銷 → 支出 → 附件 6-1 → 結案。
5. 實際列印簽到表、領據、期中／全案附件 6-1。
6. 直接開部署後的管理台真頁，確認無參數的 `whoami()` 可完成登入；這一項不能只用本機 mock 代替。

正式 Sheet 部署後只做最小 smoke：可用 Owner 真實聯絡方式送一筆清楚標記的「系統上線驗收」，確認它進入收件匣後按「略過」；或直接等第一筆真實報名完成驗收。略過後 active 收件匣會乾淨，但軟刪除的 Submission 與 AuditLog 會保留作驗收軌跡，這是預期行為，不要手動抹除。

## 5. 復原與回滾

- 大量修改前先確認右上角「已同步」，再下載管理畫面資料快照。
- 以 Google Sheet「版本紀錄」作完整復原演練；畫面 JSON 不含 Users、AuditLog、已處理報名與軟刪除資料。
- Apps Script 保留上一個已知可用、同樣從 `SHEET_ID` 屬性讀取設定的部署版本；部署後若有問題，從部署管理切回，不要直接清除正式 Sheet。仍把 dev ID 寫死的舊版本不可作 production 回滾點。
