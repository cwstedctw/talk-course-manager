# CUSTOMIZE.md — 換成自己的課：必改清單

系統的課程專屬真值集中在 `admin-v2.html` 的 `COURSE_PROFILE` 設定檔區（搜尋「課程設定檔區」註解框，從那裡到 `COURSE_PROFILE` 物件結尾為止）。原則：**換課只動這一區與下表列的點，別為單一課程需求去改框架碼**（框架契約見 `FRAMEWORK.md`）。

兩條鐵律先記住，每一列都適用：

1. `admin-v2.html` 改完，**原封複製到 `apps-script-admin/Index.html`**（位元組相同）；`join.html` 改完同步 `apps-script-join/Join.html`。
2. 改完跑 `node --test tests/v2-completion.test.mjs`，全過才部署。

下表「在哪」欄用**搜尋關鍵字**定位（行號會漂，關鍵字不會）。

## 必改清單

| # | 要改什麼 | 在哪個檔、搜什麼 | 怎麼改 |
|---|---|---|---|
| 1 | **COURSE_PROFILE 全欄** | `admin-v2.html` 搜 `const COURSE_PROFILE=` | 逐欄換成你的課：`talkCount`（場次數，改了 12 場請連同 #11 Hub 一起評估）、`weeksIntro`／`weeksAlert`（週曆頁說明文字）、`course.*`（課名 `courseName`／`shortName`、學期 `semester`、`weekday` 節次、`room` 教室、`school` 學校、`organizer` 主辦教師、`fundSource` 經費來源、`talkWindow` 演講時段、`talkDayFlow` 當日流程、`arriveBy` 建議抵達、`defaultHours` 預設時數、`defaultRate` 鐘點費率、`budgetTotal` 學期預算（選填的鐘點費追蹤上限，0＝不追蹤；與 #5 的 12 科目 `BudgetLines` 是兩回事）、`hubStartTime`、`signRows` 簽到表行數）、`hub.*`（見 #11）、`weeks`（見 #7）、`templates`（信件範本，見 #2）。⚠️ 場次數：畫面與文件多處寫死「12 場」字樣（全 repo 搜 `12 場`），改 `talkCount` 後請照 AGENTS.md 的做法讓 AI 全域掃改並跑測試 |
| 2 | **學校與教師識別** | 同上 `COURSE_PROFILE.course` 的 `school`／`organizer`；另搜 `DEF_TPL`（信件範本） | 示範值＝示範大學／王示範。範本信裡的課程主軸描述段（邀請信第一段的課程介紹、成果報告需求段）是上一門課的敘事，整段改寫成你的課；範本用 `{{學校}}`／`{{聯絡人}}` 等變數的部分會自動帶入，不用動。管理台頁面標題在 `apps-script-admin/Code.gs` 搜 `setTitle` |
| 3 | **通知信箱** | `apps-script-join/Code.gs` 搜 `NOTIFY_EMAIL` | 示範值＝`notify@example.invalid`，改成你收報名通知的信箱；`NOTIFY_SUBJECT_PREFIX` 是通知信主旨前綴（可拿來設 Gmail 篩選器自動貼標籤），順手一起改 |
| 4 | **報名頁整頁文案** | `join.html` 上半部 HTML（課程介紹、講者條件、交通住宿說明、表單欄位文案）；`apps-script-join/Code.gs` 搜 `setTitle`（頁面標題） | 整頁讀一遍逐段改——課程名稱、學校、地點、交通描述（示範值寫的是東部校區情境）、鐘點費與住宿口徑都要對上你的實際政策；`ENDPOINT` 填法見 SETUP.md 第 11 步。改完同步 `apps-script-join/Join.html` |
| 5 | **經費科目與總額（共 5 處，缺一不可）** | ① `admin-v2.html` 搜 `BUDGET_FALLBACK`（前端 fallback）② `apps-script-admin/Code.gs` 搜 `officialBudgetLines_`（後端種子，`bootstrapProduction` 種進 Sheet 的真值）③ `INTERFACE_CONTRACT.md` §A `BudgetLines` 那一列（契約文件）④ `tests/v2-completion.test.mjs` 搜總額 assert（`budgetAmount, 0)` 附近）⑤ `apps-script-admin/W1Tests.gs` 搜 `BudgetLines 12 科目就位`（總額測試） | 示範值＝12 科目、總額 300,000。五處的科目 id、名稱、金額要**完全一致**，測試就是在抓不一致。已經跑過 `bootstrapProduction` 才改的話，Sheet 裡的舊科目不會被自動覆寫——直接在 Sheet 的 `BudgetLines` 分頁改，或在開了 `ALLOW_DESTRUCTIVE_TESTS` 的測試環境跑 `seedBudgetLinesOfficial({overwriteExisting:true})` |
| 6 | **結算／撥款規則** | `admin-v2.html` 搜 `SETTLE_INSTALLMENT1` 與 `buildSettlementBody` | 示範規則＝分兩期撥款：第 1 期固定 150,000、第 2 期＝核定總額−第 1 期，期中報告執行率達 90% 解鎖第 2 期（經費頁紅綠燈照這個門檻，搜 `90% 門檻`）。你的計畫是一次撥款就把「期中結算」鈕拿掉、`C` 直接用總額；期數或門檻不同就改這兩處的數字與文案。⚠️ 日期類示範值（期中／期末報告期限、計畫期間、上下學期分界日）散在經費頁與結算表渲染碼，搜 `SETTLE_` 與 `計畫期間` 附近的日期一併換 |
| 7 | **學期週曆** | 不用改程式：管理台「設定 → 換新學期」（限 Owner），填新學期、第 1 週上課日、停課週次即可重建 | 只有「跨校或上課星期改變」才動碼：`admin-v2.html` 搜 `WEEKS_115_1`（17+1 週陣列，含假日標記）整表重寫成你學校的行事曆，並改 `COURSE_PROFILE.weeksIntro`／`weeksAlert` 敘述。新週曆一定要跟學校正式行事曆核對過 |
| 8 | **交通費估算表** | `admin-v2.html` 搜 `FARE_TO_ZHIXUE`（終點車站票價表）、`ORG_COUNTY_HINTS`（單位名→縣市對照）、`FARE_SNAPSHOT`（票價查核日） | 示範表以東部示範校區最近車站為終點、列 16 縣市單程票價，並靠 `ORG_COUNTY_HINTS`（「單位名稱含某關鍵字→算某縣市」）自動猜講者出發地。**換校＝整表重建**：終點、每條路線、票價全都要用你學校重查一遍，並更新 `FARE_SNAPSHOT` 日期。懶得建可以先停用：把 `FARE_TO_ZHIXUE` 清成 `{}`，估算功能會安靜地不出字，其餘功能不受影響 |
| 9 | **領據／收支結算表版式** | `admin-v2.html` 搜 `buildReceiptBody`（領據代填）與 `buildSettlementBody`（收支結算表） | 這兩張是綁台灣體系的列印文件：領據照原學校主計室制式表一比一復刻（金額大寫、民國日期、所得類別），結算表照台灣教育部「附件6-1」版面。同在台灣教育部計畫體系的學校多半可直接用（先拿你學校主計室的表比對欄位）；版式不同就整個函式重寫成你的表，或不用列印功能、只用系統追蹤進度 |
| 10 | **成果指標（moe 六面向）** | `admin-v2.html` 搜 `const MOE=`（六面向定義）與 `COURSE_PROFILE.hub.moeIndicators`；`apps-script-admin/Code.gs` 搜 `allowedMoe`；`tests/v2-completion.test.mjs` 搜 `MOE_KEYS` | 示範值＝台灣教育部「負責任使用 AI」六面向（b1_ethics…b3_account），是場次標籤兼成果報告歸類軸。你的計畫有自己的指標就把三處的鍵值一起換（前端定義、後端 enum、測試 assert）；沒有指標需求可保留不理，或把 `MOE` 改成你自己想追蹤的主題分類 |
| 11 | **Hub 匯出（多數學校可忽略）** | `admin-v2.html` 搜 `COURSE_PROFILE.hub`（`courseDir`／`joinUrl`）與 `hubJson` | 這是把已確認場次匯出成 JSON、貼給另一個「課程前台網站」的功能。沒有前台網站就完全不用理它（匯出鈕放著不按就好）；有的話把 `courseDir` 改成你前台的課程目錄名、`joinUrl` 改成你的報名頁網址 |

## 附：示範真值總表（各檔對齊用）

> 本節記「分享版採用的示範數字」，供各檔（`admin-v2.html`／`join.html`／apps-script）對齊。
> 全部是虛構示範值，clone 後請照自己的核定經費表與課程資訊改（對照上面必改清單逐項換）。

### 統一示範真值

| 項目 | 示範值 |
|---|---|
| 學校 | 示範大學 |
| 主辦教師（organizer／信件署名） | 王示範 |
| owner 信箱（mock 登入者） | owner@example.invalid |
| editor 信箱 | editor@example.invalid |
| 通知信 | notify@example.invalid |
| 報名頁網址（joinUrl，QR code 同步吃它） | https://your-talks-signup.example.invalid |
| 經費來源（fundSource） | （示範）教育部AA計畫補助 |
| 經費總額 | 300,000 |
| 第 1 期撥款（SETTLE_INSTALLMENT1） | 150,000（機制不變：期中結算 C 只認第 1 期） |
| 第 2 期 | 核定總額 − 150,000 ＝ 150,000（由程式計算，不寫死） |
| 第 2 期撥款門檻 | 執行率 90%（機制不變） |
| 課程名稱（courseName） | AI 未來應用與趨勢探索（示範課） |
| Hub 課程代碼（courseDir／mock 儲存鍵） | demo-ai-talks |

另外注意：示範講者有**兩組假名、用途不同**——講者庫「匯入示範名單」用王示範／林假名／陳例子／張測試（`PLAN_SPEAKERS`），本機 mock 種子畫面用林示範／陳示範／張示範（`seedFakeData`）。都是虛構人物，看到兩組名字不同不是 bug。

### 示範經費表：12 科目示範金額（BUDGET_FALLBACK，合計 300,000）

| id | 科目 | 示範金額 |
|---|---|---:|
| bl_fee | 講座鐘點費 | 100,000 |
| bl_fee_nhi | 講座二代健保 | 2,110 |
| bl_trans | 講師交通費 | 20,000 |
| bl_temp | 臨時人員費 | 40,000 |
| bl_temp_ins | 臨時人員勞健退 | 8,000 |
| bl_host | 主持費 | 12,000 |
| bl_host_nhi | 主持費二代健保 | 253 |
| bl_guide | 指導費 | 12,000 |
| bl_guide_nhi | 指導費二代健保 | 253 |
| bl_print | 印刷費 | 50,000 |
| bl_misc | 雜支 | 28,384 |
| bl_admin | 行政管理費 | 27,000 |
| **合計** | | **300,000** |

備註：二代健保示範值照「鐘點費類金額 × 2.11%」取整（100,000→2,110；12,000→253），
與 BUDGET_AUTO 的 bl_fee_nhi 自動彙總邏輯（×2.11%）口徑一致；雜支當平衡項湊整合計。

### 示範講者名單（PLAN_SPEAKERS，4 筆）

| 姓名 | 職稱 | 單位 | 類別索引 |
|---|---|---|---:|
| 王示範 | 教授 | 示範大學法律學系 | 0 |
| 林假名 | 副教授 | 範例科技大學資訊工程系 | 1 |
| 陳例子 | 主治醫師 | 示範醫院家庭醫學科 | 3 |
| 張測試 | 研究員 | 示範研究院 | 5 |

類別索引對應 PLAN_SPK_CATS（0–5）；匯入後 status＝口袋名單、notes＝「示範名單・僅供參考」。
把你的口袋名單照同格式貼進 `PLAN_SPEAKERS` 即可批次匯入。

### 保留當範例（未改成示範值的部分）

- 115-1 學期週曆（`WEEKS_115_1`）與 `weeksIntro` 說明（含行事曆來源標註）——換學期／換校見 #7。
- 交通費估算表（東部示範校區最近車站的票價表）與 `ORG_COUNTY_HINTS` 縣市提示——換校見 #8。
- 領據／收支結算表（附件 6-1）版式；主計室制式表下載連結保留為版式範例，
  版面上的校名欄位已改讀 `settings.school`——版式不同見 #9。

## 改完之後

```bash
node --test tests/v2-completion.test.mjs   # 全過
```

再照 SETUP.md 第 4 步 `clasp push -f`＋更新部署。已在營運中的 Sheet 要動經費科目或指標，先下載一份資料快照（設定 → 資料）再動。
