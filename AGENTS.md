# AGENTS.md — 給 AI 助手的工作守則

這個 repo 是「演講課管理台」的公開分享版：Google Apps Script＋私有 Google Sheet 後端、單檔 HTML 前端，管理一學期 N 場系列演講的邀約、行政、核銷與成果。使用者多半是想把它客製成自己學校課程的老師——你的工作通常是照 `CUSTOMIZE.md` 的清單幫忙改。

先讀這三份再動手：

- `CUSTOMIZE.md`：必改清單（要改什麼、在哪、怎麼改）。
- `FRAMEWORK.md`：分層架構與框架契約（不變量）。
- `INTERFACE_CONTRACT.md`：前後端 API 與 Sheet schema 契約。

## 鐵律（違反任何一條就是改壞了）

1. **雙檔同步**：`admin-v2.html` 必須與 `apps-script-admin/Index.html` **位元組相同**；`join.html` 必須與 `apps-script-join/Join.html` 位元組相同。改任一邊，就把整個檔案原封複製到另一邊。測試會用 `assert.equal` 逐字比對，差一個空白都算失敗。
2. **改完必跑測試**：`node --test tests/v2-completion.test.mjs`，全數通過才算完成。測試同時驗雙檔同步、inline script 語法、經費五處一致、個資哨兵等契約。
3. **`.clasp.json` 不進 git**：scriptId 屬於各自的部署者，`.gitignore` 已擋，不要硬加。
4. **真實個資不進 repo**：真實講者姓名、聯絡方式、報名內容、學生資料一律不出現在程式碼、測試資料或文件裡；示範資料用「王示範」「`*@example.invalid`」這類明顯假值。
5. **SHEET_ID 只走 Script Properties**：試算表 ID 不寫進任何原始碼、文件或 commit；程式執行時只讀 Apps Script 指令碼屬性 `SHEET_ID`。

## 框架契約速記（詳見 FRAMEWORK.md）

- 場次編號＝日期順序，日期變動後必走 `renumber()`；別直接改編號。
- 外來 JSON 一律過 `normalize()` 消毒（allowlist 重建，未知欄位不落地）。
- 使用者資料進 HTML 前一律過 `esc()`；事件走 `data-act`／data-* 委派，不用 inline handler。
- 身分證字號、戶籍、銀行帳號等個資不設欄位、不入系統（領據留白手寫）。
- 課程專屬真值只動 `COURSE_PROFILE` 設定檔區；框架碼是通用的，別為單一課程需求去改。

## 客製起手 prompt 範例

拿去改給使用者參考，或使用者貼給你時照做：

> 「把這套系統改成○○大學的『△△△△』課：一學期 10 場（不是 12 場）、週三第 3–4 節、地點□□館 201。照 CUSTOMIZE.md 的清單逐項改，經費總額換成 250,000、不分期撥款。改完跑測試給我看結果。」

> 「我們學校不在台灣教育部計畫體系。幫我停用領據列印、收支結算表和交通費估算（照 CUSTOMIZE.md #8 #9 的停用方式），其他功能保留。報名頁文案整頁改成英文。」

> 「照 SETUP.md 幫我把兩個 Apps Script 專案架起來：我已經 `clasp login` 好了，Sheet ID 我自己會填進指令碼屬性，你負責 create、push 和告訴我部署時要選什麼設定。我用的是個人 Gmail，記得照 SETUP.md 第 8 步把管理台 access 改成 MYSELF。」
