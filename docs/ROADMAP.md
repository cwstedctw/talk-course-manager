# 第一階段施工計畫

## P0：權限與安全驗證

- 驗證 owner、editor、同網域未授權者與網域外帳號。
- 驗證 `Session.getActiveUser().getEmail()` 在目標 Workspace 部署設定下可用。
- 建立 owner bootstrap，禁止零 owner 部署。

## P1：通用核心

- 移除固定學校、固定學期、固定星期與固定 12 場假設。
- 建立課程、週曆、排除日、場次、講者與待辦資料模型。
- 將學校專屬核銷、領據、Hub 與經費規則排除於 general build。

## P2：設定管線

- 完成 JSON Schema。
- 完成語意驗證與週曆預覽。
- 支援表單輸入與 AI 草稿匯入。
- 確认後才寫入 Sheet `Settings`。

## P3：安裝與建置

- 建立單一原始碼到 Apps Script 發布物的可重現建置。
- 建立 Google Sheet 範本與初始化程式。
- 建立 Workspace 部署與健檢指南。

## P4：alpha 驗收

- 至少兩個獨立 Workspace 網域測試。
- 非工程使用者只看文件完成安裝。
- owner 可登入、editor 可共同編輯、denied 讀不到資料。
- 週曆正確，第一筆場次重新整理後仍存在。

通過 alpha 後，才開始討論公開報名頁與跨網域帳號。

