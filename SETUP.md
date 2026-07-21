# SETUP.md — 從零到可用

照這份文件做完，你會有：一份私有 Google Sheet（正式資料）、一個私有管理台網址（給你和助理用）、一個公開報名頁網址（給講者填）。全程只需要一個 Google 帳號；步驟寫給人照做，也寫給 AI 助手照做。

系統有兩個 Apps Script 專案，等一下會各架一次：

- **專案 A**＝`apps-script-admin/`：私有管理台（限授權名單）。
- **專案 B**＝`apps-script-join/`：公開報名收件端點（匿名可送）。

## 0. 前置

- Google 帳號（學校 Google Workspace 帳號或個人 Gmail 都可以，差別見第 8 步的存取權說明）。
- [Node.js](https://nodejs.org/)（跑 clasp 與本機測試用）。

### 要裝什麼？AI 能幫你做到哪裡？

只需要裝一樣東西：**clasp**（Google 官方的 Apps Script 命令列工具，`npm i -g @google/clasp`）。除此之外不需要任何帳號、金鑰或付費服務——資料存在你自己的 Google Sheet，程式跑在你自己的 Apps Script。

如果你用的 AI 助手能執行終端機指令（Claude Code、Codex CLI 這類），它可以代勞絕大部分：裝 clasp、建專案、推程式、部署、跑測試、驗證結果。**但有三個地方 Google 只認人手，AI 一定按不了**：

| 一定要你自己點 | 在哪一步 | 為什麼 |
|---|---|---|
| `clasp login` 的瀏覽器授權 | 第 2 步 | Google 帳號登入，AI 不能代登 |
| 執行 `bootstrapProduction` 並勾選權限 | 第 6 步 | 編輯器的函式選單擋掉程式化點擊；權限同意畫面只認真人 |
| 執行專案 B 的 `doGet` 並勾選權限 | 第 10 步 | 同上 |

實際體感：整個安裝流程你大概只需要動手 3–5 次，其餘可以交給 AI。**這三步的共同陷阱是「權限勾選要全部勾」**——沒勾滿不會報錯，但程式會靜靜地做不了事，第 6 步和第 13 節都有詳細說明。

如果你完全不想碰命令列，也可以走第 3 步的「路 B」：在 <https://script.google.com> 網頁版建專案，把檔案內容手動貼進去。缺點是 `Index.html` 有 25 萬字元，貼起來很痛苦，不建議。

## 1. 建 Google Sheet

1. 用你的 Google 帳號新增一份**私有**試算表，命名例如「演講課管理台（正式）」。不用建任何分頁或欄位，稍後 `bootstrapProduction()` 會自動建 schema。
2. 從網址複製 Sheet ID（`https://docs.google.com/spreadsheets/d/`**這一段**`/edit`）。**這個 ID 不要貼進 repo、issue 或任何會公開的地方**——它只會進 Apps Script 的指令碼屬性（第 5 步）。

## 2. 安裝 clasp 並登入

```bash
npm i -g @google/clasp
clasp login
```

（沒有全域安裝權限時，後續所有 `clasp ...` 指令都可改用 `npx @google/clasp ...` 執行。）

再到 <https://script.google.com/home/usersettings> 把「Google Apps Script API」切成**開啟**（沒開的話 `clasp push` 會被拒絕）。

## 3. 建兩個 Apps Script 專案

兩條路擇一，`apps-script-admin/` 與 `apps-script-join/` 各做一次：

**路 A：clasp create（沒有既有專案時）**

```bash
cd apps-script-admin
clasp create --type standalone --title "演講課管理台（管理端）"
cd ../apps-script-join
clasp create --type standalone --title "演講課管理台（報名收件）"
```

`clasp create` 會在資料夾裡自動產生 `.clasp.json`（記著 scriptId）。

⚠️ 這一步有三個已實測的坑（clasp 3.3.0）：

- **一定要用 `--type standalone`**，不能用 `--type webapp`——後者會直接失敗（`Invalid container file type`）。網頁應用程式是「部署方式」，不是專案類型；standalone 專案照樣能部署成 Web App。
- **create 會覆蓋 `appsscript.json`**（把時區改成美東、拿掉 Web App 設定）。create 完馬上還原：`git checkout -- appsscript.json`，再往下走。不還原的話部署設定會全錯。
- **報 `Project file already exists.` 但資料夾裡明明沒有 `.clasp.json`**：clasp 會往上層目錄找，通常是某個祖先目錄（例如系統暫存資料夾）留了一顆舊的。把那顆找出來改名即可（`.clasp.json` → `.clasp.json.bak`）。

**路 B：先在網頁建專案，再接上（已有專案或偏好網頁操作時）**

1. 到 <https://script.google.com> 各建一個空白專案，從網址或「專案設定」抄下 scriptId。
2. 在各資料夾把 `.clasp.json.example` 複製成 `.clasp.json`，填入自己的 scriptId。

不管走哪條路，`.clasp.json` 都**不進 git**（`.gitignore` 已擋）；scriptId 是你個人部署的識別，別人 clone 這個 repo 要用自己的。

## 4. 推送程式

兩個資料夾各推一次：

```bash
cd apps-script-admin
clasp push -f
cd ../apps-script-join
clasp push -f
```

`-f` 會把 `appsscript.json`（時區、OAuth scope、Web App 存取設定）一起推上去。推完先確認推送目標是對的專案，別把管理端推進報名端。

## 5. 設定 SHEET_ID 指令碼屬性

程式碼裡刻意不放試算表 ID，執行時只讀 Apps Script 的 `SHEET_ID` 指令碼屬性；缺漏或格式錯誤會直接停止，不會退回範例資料。

兩個專案都要設：Apps Script 編輯器 →「專案設定」（齒輪）→「指令碼屬性」→ 新增屬性 `SHEET_ID`，值填第 1 步的 Sheet ID。**兩個專案填同一個 ID**（同一份 Sheet：管理台讀寫全部、報名端只 append `Submissions` 分頁）。

另外確認正式專案的指令碼屬性**沒有** `ALLOW_DESTRUCTIVE_TESTS`（或值不是 `true`）。這道閘擋的是測試種子資料與覆寫既有經費科目，只准在測試用的 dev Sheet 開。

## 6. 跑 bootstrapProduction（把執行者設成 Owner）

在**專案 A** 的 Apps Script 編輯器：上方函式下拉選 `bootstrapProduction` → 按「執行」→ 完成 OAuth 授權（只要求試算表與登入 email 兩個權限）。

> 🚨 **授權畫面的勾勾一定要全部勾起來**（「查看、編輯…你的 Google 試算表」＋「查看你的主要電子郵件地址」）。只勾一部分的話，會進入一個很難自己看出來的死巷：程式拿不到試算表權限、執行記錄卻照樣顯示「已完成」，Sheet 裡什麼都沒生出來。
>
> 如果懷疑自己勾漏了：到 <https://myaccount.google.com/connections> 找到這個專案 → 進去 → 最下面「刪除所有連結」→ 回編輯器重跑 `bootstrapProduction`，授權畫面會重新出現，這次全部勾。
>
> **怎麼確認真的成功**：打開你的 Google Sheet，底下應該多出 11 個分頁（`Speakers`、`Talks`…），`Users` 分頁有你的 email、`BudgetLines` 有 12 列。看不到就是沒成功，別往下走。

它做的事（冪等、可重跑）：

1. 建立全部資料分頁與表頭（`Speakers`／`Talks`／`Weeks`／`Tasks`／`Reimbursements`／`Submissions`／`BudgetLines`／`Expenses`／`Users`／`AuditLog`／`Settings`），並把日期、電話類欄位鎖成文字格式。
2. 把**執行這個函式的帳號**寫進 `Users` 分頁、角色 `owner`——所以請用你要當管理者的那個帳號執行。
3. 在 `Settings` 種入 `schemaVersion`，在 `BudgetLines` 種入 12 條示範經費科目（總額 300,000；之後照 CUSTOMIZE.md 換成你的實際經費）。

預期回傳：`ok: true`、`owner` 是你的 email、`budgetLineCount: 12`。重跑時已存在的經費科目預設保留不覆寫；`{overwriteExisting:true}` 只在開了 `ALLOW_DESTRUCTIVE_TESTS` 的測試環境有效。

它刻意**不建任何講者、場次或報名假資料**。想要一套假資料練手，另外準備一份 dev Sheet 再執行 `seedFakeData()`，不要對正式 Sheet 跑。

跑完 `bootstrapProduction` 後，**在同一個函式下拉再選 `migrateToV2` 執行一次**（冪等、可重跑）：它會補種 `courseInstanceId`（課程實例的永久識別，換學期與成果報告功能用得到）。

## 7. 部署專案 A（私有管理台）

> ⚠️ 用**個人 Gmail**（不是學校／公司 Workspace 帳號）的請先跳去看第 8 步：預設 `access: DOMAIN` 只有 Workspace 帳號能用，個人帳號要先把 `apps-script-admin/appsscript.json` 的 access 改成 `MYSELF` 再回來部署，否則這一步會失敗或部署出誰都開不了的網址。

Apps Script 編輯器右上「部署」→「新增部署作業」→ 類型選「網頁應用程式」：

- 執行身分：**我**
- 具有存取權的使用者：Workspace 帳號選**貴機構網域**；個人 Gmail 見第 8 步

按「部署」，記下 Web App URL——這就是管理台網址。開啟它、用 Owner 帳號登入，看到「已同步」就代表通了。

之後更新程式：`clasp push -f` 再 `clasp deploy -i <deploymentId>`，網址不變。

## 8. ⚠️ Web App 存取權：學校 Workspace 與個人 Gmail 的差別

`apps-script-admin/appsscript.json` 內建 `"access": "DOMAIN"`。這個值**只適用 Google Workspace（例如學校）帳號**——意思是「同網域的人才能開啟網頁」；個人 Gmail 沒有網域，部署會直接失敗或無法選這個選項。

`access` 的官方合法值有四個（Apps Script manifest 文件）：

| 值 | 誰能開啟 | 適合 |
|---|---|---|
| `MYSELF` | 只有部署者本人 | 個人 Gmail、一人管課 |
| `DOMAIN` | 同 Workspace 網域的登入者 | 學校帳號、要跟助理協作（**預設**） |
| `ANYONE` | 任何登入 Google 的人 | 見下方取捨，管理台一般不建議 |
| `ANYONE_ANONYMOUS` | 任何人、免登入 | 只給專案 B 報名端用 |

**個人 Gmail 怎麼改**：把 `apps-script-admin/appsscript.json` 的 `"access"` 改成 `"MYSELF"`，重新 `clasp push -f` 並部署。一人用完全夠。

**個人 Gmail 想多人協作的取捨要先知道**：改成 `ANYONE` 雖然能讓別的 Google 帳號開啟頁面（伺服器端 `Users` 授權表仍會擋住沒授權的人），但本系統以 `Session.getActiveUser()` 辨識登入者，而在「執行身分＝我」的部署下，**非同網域的訪問者常拿不到 email**，伺服器會安全地拒絕（fail closed）——結果就是協作者登不進去。所以：跨帳號多人協作請用同網域的 Workspace 帳號；個人 Gmail 就維持 `MYSELF` 單人用。（把執行身分改成 `USER_ACCESSING` 理論上可繞過，但那會要求每位使用者自行授權並直接開放 Sheet 存取權，整個信任邊界都變了，不建議在沒讀懂 `INTERFACE_CONTRACT.md` 前嘗試。）

專案 B 的 `"access": "ANYONE_ANONYMOUS"` 不分帳號型態都照用——報名頁本來就要讓沒登入的講者填。

## 9. Users 授權表（加協作者）

需要助理或共同教師時，直接在正式 Sheet 的 `Users` 分頁加一列：`email` 填對方帳號、`role` 填 `editor`（`owner` 保留給你自己）。同網域不等於已授權——**只有 `Users` 名單裡的帳號拿得到資料**；Editor 可管講者、場次、待辦、核銷、經費與報名，但看不到 `Users`／`AuditLog`、不能改 `Settings`。

## 10. 部署專案 B（公開報名端點）

在專案 B 的編輯器「部署」→「新增部署作業」→「網頁應用程式」：

- 執行身分：**我**
- 具有存取權的使用者：**任何人**（`ANYONE_ANONYMOUS`）

🚨 **部署完還要自己觸發一次授權**：部署動作本身不會跳 OAuth 畫面。請在專案 B 的編輯器裡，函式下拉選 `doGet` → 按「執行」→ 完成授權（試算表＋寄信兩項，**一樣要全部勾**）。跳過這步的話，報名頁對外會直接顯示「存取遭拒」，而你自己開卻是好的（因為你是專案擁有者）——很容易誤判成已經上線。

部署後用 `<Web App URL>?ping=1` 檢查，回 `{ok: true}` 就通了；**用無痕視窗開一次**（模擬沒登入的講者），確定不是「存取遭拒」才算真的對外可用。這個端點只能新增報名資料與回覆去個資檔期（`?schedule=1`，只回日期與狀態），讀不到講者聯絡方式或任何管理資料。

營運註：公開端點有**全站每小時 30 筆**的粗閘（`RATE_MAX_PER_HOUR`，防灌水；另有單一來源每小時 3 筆限制）。一般課程的報名量遠用不完；若辦公開活動遇高峰，把這個常數調大再重新部署即可。

## 11. 公開報名頁上線（兩條路擇一）

**路 A：直接用 Apps Script 內建頁（最省事）**——專案 B 的 Web App URL 本身就會顯示報名頁（`doGet` 直接出頁、頁內走 `google.script.run` 送件，沒有跨域問題）。把這個網址發給講者就能用。缺點是網址長得像 `script.google.com/...`，不太好看。

**路 B：靜態託管自己的網址**——把 `join.html` 裡的 `ENDPOINT` 常數填上專案 B 的 Web App URL，再把這個檔案丟到任何靜態託管（Netlify、GitHub Pages、學校網頁空間都行）。頁面會用 `fetch` 把報名送到你的端點。上線前實際送一筆測試資料，確認 Sheet 的 `Submissions` 有進資料、通知信有寄到（通知信箱改法見 CUSTOMIZE.md）。

## 12. 驗收清單

- [ ] 管理台網址用 Owner 帳號開啟，右上角顯示「已同步」。（第一次開會自動預排 12 場並寫進 Sheet；若跳出「衝突 N 筆」對話框，見下方「首次開啟就跳衝突」。）
- [ ] `Users` 沒列的帳號開管理台，停在拒絕畫面、拿不到資料。
- [ ] 報名頁送一筆測試（姓名標「系統驗收」），管理台「報名」收件匣看得到，按「略過」處理掉。
- [ ] 報名頁個資告知已換成自己的：聯絡人姓名與信箱、利用期間的日期（`join.html` 搜「個人資料保護法」那段）。
- [ ] 已決定報名資料的屆期處理方式：期限到了由管理者直接在 Sheet 刪除（系統的 `purgeDeleted` API 目前是未實作的預留 stub，個資告知承諾的刪除要靠人工執行）。
- [ ] 本機跑 `node --test tests/v2-completion.test.mjs`，全數通過。

## 13. 疑難排解（實際裝過一輪整理出來的）

**執行記錄說「已完成」，Sheet 卻什麼都沒生出來**
授權時勾勾沒全勾。伺服器把權限錯誤包成一般錯誤訊息回傳，畫面上看不出來。解法見第 6 步的紅字：去 <https://myaccount.google.com/connections> 刪掉這個專案的連結，重跑一次並全部勾選。

**報名頁對外顯示「存取遭拒」，自己開卻正常**
專案 B 沒完成授權（部署不會自動要求）。回第 10 步，在編輯器手動執行一次 `doGet`。驗收一律用無痕視窗。

**`clasp create` 說 `Project file already exists.`，但資料夾裡沒有 `.clasp.json`**
clasp 會往上層目錄找。檢查專案的各層父目錄（含系統暫存資料夾）有沒有殘留的 `.clasp.json`，改名即可。

**`clasp create --type webapp` 失敗（`Invalid container file type`）**
用 `--type standalone`。standalone 專案照樣部署得成 Web App。

**create 之後部署設定怪怪的**
`clasp create` 會覆寫 `appsscript.json`。用 `git checkout -- appsscript.json` 還原後重推。

**用 curl 測試投稿，中文變亂碼**
測試工具的問題，不是系統的問題。Windows 的 curl 會用系統編碼（cp950）送中文。要用命令列測投稿，改用 Node：`fetch(url, {method:'POST', body: JSON.stringify(rec)})`，中文會正確落地（實測過）。瀏覽器送出的正常投稿一律沒問題。

**首次開啟就跳「衝突 N 筆」**
已知問題（見 [KNOWN-ISSUES.md](KNOWN-ISSUES.md)）：全新安裝第一次開管理台時，前端會自動預排 12 場並寫進 Sheet，但本機基準沒有同步更新，於是同一批資料自己跟自己對撞。資料本身是好的（Sheet 裡就是那 12 場），逐筆選「採對方（丟棄我的）」即可，之後不會再出現。

## 附：本機開發

改前端不用每次部署：用任何 preview server 開 `admin-v2.html`（mock 模式，不會碰正式 Sheet）——例如在 repo 目錄跑 `npx --yes serve .` 再開瀏覽器，或用 VS Code 的 Live Server。改完記得把 `admin-v2.html` 原封複製到 `apps-script-admin/Index.html`（兩檔必須位元組相同，測試會驗），再 `clasp push -f` 部署。詳見 [AGENTS.md](AGENTS.md) 的鐵律。
