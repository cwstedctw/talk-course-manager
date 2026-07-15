# 同校 Google Workspace 安裝規格

> 本文件目前是安裝流程規格，不是已完成的使用手冊。

## 安裝前條件

- 學校提供的 Google Workspace 帳號。
- 可建立 Google Sheet 與 Apps Script。
- Workspace 管理員未封鎖 Apps Script Web App。
- 所有協作者使用相同學校網域。

## 目標部署設定

- 執行身分：部署者。
- 存取範圍：部署者所屬網域。
- 應用程式內部：再以 `Users` 白名單區分 owner、editor 與 denied。

## 預定安裝流程

1. 複製空白 Sheet 範本。
2. 執行初始化，建立必要分頁。
3. 將目前安裝者設成唯一第一位 owner。
4. 匯入並預覽課程設定。
5. 執行部署前健檢。
6. 使用者本人確認 OAuth 與部署權限。
7. 以 owner 帳號登入。
8. 加入一位同網域 editor。
9. 用未列白名單帳號確認資料被拒絕。

## 完成定義

- owner 能看到並修改課程。
- editor 能修改業務資料，但不能修改使用者及系統設定。
- denied 帳號拿不到 snapshot 或任何課程資料。
- 寫入一筆場次後重新整理，資料仍存在。

