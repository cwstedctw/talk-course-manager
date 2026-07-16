# 第一階段進度與驗收

## 已完成：通用核心與設定管線

- [x] 移除固定學校、學期、星期與場次假設。
- [x] 建立課程、週曆、排除日、場次、講者與待辦資料模型。
- [x] 完成 JSON Schema、語意驗證、跨年度排程與週曆預覽。
- [x] 支援表單輸入、AI 草稿匯入與人工確認後匯出。
- [x] 排除學校專屬核銷、領據、經費與校內連結。

## 已完成：同網域 Apps Script alpha

- [x] 建立 owner bootstrap、owner／editor 伺服器端角色驗證與最後一位 owner 保護。
- [x] 建立講者、場次、待辦、使用者、稽核與交易復原資料表。
- [x] 加入 revision、row version、`ScriptLock`、公式注入防護與 transaction journal。
- [x] 建立可重現的 Apps Script、GitHub Pages 與 release 建置。
- [x] 建立 Workspace 安裝、AI 設定、隱私、安全與健檢文件。

## 待完成：Workspace 實機 alpha 驗收

- [ ] owner、editor、同網域未授權者與網域外帳號實測。
- [ ] 驗證 `Session.getActiveUser().getEmail()` 在至少兩個獨立 Workspace 網域可用。
- [ ] 非工程使用者只看文件完成一次安裝。
- [ ] 兩個帳號同時編輯時，舊 revision／version 正確被拒絕。
- [ ] 新增場次後重新整理，資料仍存在；中斷交易可由 journal 復原。

完成這份驗收後，再評估公開報名頁、一般 Gmail 與跨網域帳號。
