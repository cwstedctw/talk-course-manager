# 部署手冊（專案 B：公開講者報名端點）

> 本資料夾是獨立的公開收件專案。它只允許新增 `Submissions`，以及由 `?schedule=1` 讀取去個資檔期（固定只回 `date`／`status`）；不能讀取講者聯絡、講題、備註、核銷或其他管理資料。專案 A（私有管理台）與專案 B（公開報名端點）分開部署，是為了避免一次部署設定錯誤就把私有管理台對外開放。

## 0. 建立你自己的 Apps Script 專案

1. 安裝並登入 clasp：`npm install -g @google/clasp`，然後 `clasp login`。
2. 二選一：
   - **全新建立**：在本資料夾執行 `clasp create --type standalone --title "演講課公開報名"`，clasp 會自動產生 `.clasp.json`。（⚠️ `--type webapp` 在 clasp 3.3.0 已失效、會回 `Invalid container file type`；standalone 專案照樣部署得成 Web App。create 會覆寫 `appsscript.json`，記得 `git checkout -- appsscript.json` 還原。詳見 [SETUP.md](../SETUP.md) 第 3 步。）
   - **已有專案**：把 `.clasp.json.example` 複製成 `.clasp.json`，將 `scriptId` 換成你自己的專案 ID（Apps Script 編輯器「專案設定」頁可查）。
3. `.clasp.json` 內含你的 scriptId，建議不要 commit 進公開 repo。

## 1. 對準正式 Sheet

到本專案的「專案設定 → 指令碼屬性」新增 `SHEET_ID`，填入與專案 A（管理台）完全相同的 production Sheet ID。`Code.gs` 不保存實際 ID；缺漏或格式錯誤會停止收件。正式 Sheet schema 先由專案 A 的 `bootstrapProduction()` 建立。

Script Properties 是整個 Apps Script 專案共用，不隨 deployment 版本切換；若 staging 與 production 要同時運作，必須使用不同 Apps Script 專案，不能期待 `/dev` 與 `/exec` 各讀不同值。

## 2. 推送程式

```powershell
cd <本資料夾>
clasp status
clasp push -f
```

確認推送目標是專案 B（報名端點），不是管理台的 scriptId。

## 3. 部署

1. 先確認目前的 `deploymentId` 與 Web App URL，以及公開報名頁（若另外放在靜態網站託管，如 Netlify／GitHub Pages）正在使用的 `ENDPOINT`；正式網址與 ID 建議不要貼進公開 repo。
2. **正式上線預設更新既有 deployment，保留原 Web App URL**：可在部署管理頁編輯既有部署並選取新版本，或執行 `clasp deploy -i <deploymentId>`。不要在尚未確認公開入口時直接另建新 deployment。
3. 確認既有部署仍是：
   - 執行身分：**我**
   - 具有存取權的使用者：**任何人**
4. 完成試算表與寄送通知信所需 OAuth 授權（第一次部署會跳出授權畫面，由專案擁有者親自同意）。
5. 用 `<Web App URL>?ping=1` 檢查是否回傳 `ok: true`；再從實際公開的報名頁送出測試資料。

若既有 deployment 無法沿用、確實必須建立新 URL，必須在同一次上線完成以下其中一條路徑：

- 沿用外部靜態託管的公開頁：把部署用 `join.html` 的 `ENDPOINT` 改成新 Web App URL、重新發布靜態頁，並實際投遞驗證。
- 改用 Apps Script 內建頁（doGet 直接服務 `Join.html`）：把管理台 `COURSE_PROFILE.hub.joinUrl` 與已發出的 QR code 全部改指新 Web App URL；內建頁直接走 `google.script.run`，不需要 CORS。

只要公開入口、管理台按鈕或 QR code 還有一處指向舊端點，就不得把上線關卡標成完成。

## 4. 驗收

### staging 完整驗收

1. 無痕視窗開報名頁，送出一筆自薦與一筆推薦。
2. 送出成功後，確認私有 Sheet 的 `Submissions` 新增資料，且通知信抵達。
3. 管理台重新整理後，兩筆都出現在「報名」收件匣。
4. 一筆「轉講者庫」、一筆「略過」，確認 active 收件匣消失且 AuditLog 有對應動作。
5. 重複轉入同一 submission 應回 `not_found`，不可建立重複講者。
6. `?schedule=1` 只回 `date`／`status`；已確認或已完成日期在公開頁顯示「已確認」且不可選，其他開放日期可選。若端點失敗，公開頁只顯示灰色「檔期待確認」，不得推定為開放。
7. 只填姓名、手機 `0900123456` 的自薦資料，確認 Sheet、管理台收件匣與轉入後的講者電話都保留前導 `0`。
8. 模擬第一次送出已寫入 Sheet、但瀏覽器未收到回應，再用同一 `clientId` 重送；應回成功且 `duplicate:true`，Sheet 仍只有一列、通知信不重寄。
9. 自薦缺姓名或聯絡方式、推薦缺被推薦人姓名時，伺服器必須回 `validation`，不能只依賴瀏覽器必填欄位。

### production 最小 smoke

- 不要在正式 Sheet 重跑上面整套假資料流程，也不要執行 `runV2CompletionSuite()`。
- 可用主辦教師真實聯絡方式送一筆姓名清楚標記為「系統上線驗收 YYYY-MM-DD」的資料，確認通知信與管理台收件匣後按「略過」；或直接用第一筆真實報名驗收。
- 略過後 active 收件匣會移除該筆；軟刪除的 Submission 與 AuditLog 仍會留在 Sheet 作驗收軌跡，這是預期行為。

## 5. 安全檢查

- 公開端點唯一讀取 API 是 `?schedule=1`，回應列只能有 `date`／`status`；不得回傳姓名、email、電話、講題、摘要、備註、核銷或任一完整 Sheet 列。
- 身分證字號格式應被拒絕；payload 過大、節流或忙碌時應顯示真實錯誤，不可假裝收件成功。
- 自由文字無法可靠辨識所有地址、銀行帳號或學生資料；公開頁必須顯示禁止輸入提醒。若誤填，管理台只按「略過」，不得轉入講者庫。
- Sheet、通知信內容與管理台網址都不得出現在公開 repo；repo 只保存程式與假資料測試。
- 記錄 deploymentId、URL、版本、executeAs 與 access（存在你自己的私人筆記，不進公開 repo），並保留上一個同樣從 `SHEET_ID` 屬性讀取設定的可回滾版本；仍把 dev ID 寫死的舊版本不可作 production 回滾點。
