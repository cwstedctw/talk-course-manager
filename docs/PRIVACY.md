# 隱私與安全邊界

## GitHub 可以保存

- 程式碼
- 空白設定 schema
- 合成範例資料
- 安裝與使用文件

## GitHub 不得保存

- 講者姓名與聯絡方式
- 學生資料
- Google Sheet、Script 或 deployment ID
- OAuth token、API key 或 Cookie
- 真實報名內容
- 私有課程備份

## 管理台資料

正式資料只進安裝者自己的 Google Sheet。備份檔可能包含講者聯絡資料，使用者必須把備份視為個資檔案。

## 權限

Google Workspace 的網域限制是第一層；應用程式的 `Users` 白名單是第二層。任何 API 都必須在伺服器端驗證角色，不能只靠前端隱藏功能。

