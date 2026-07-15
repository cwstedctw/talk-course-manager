# 公開版架構

## 第一階段邊界

```text
GitHub repository
├─ 文件、schema、空白範例與原始碼
└─ 未來的靜態 Demo／設定產生器

每所學校自己的 Google Workspace
├─ 私有 Apps Script 管理台
└─ 私有 Google Sheet
```

GitHub 不提供中央資料庫，也不保存課程或講者資料。

## 執行期真值

- 安裝前：`course.config.json` 是已確認的可攜式設定。
- 安裝後：Google Sheet `Settings` 是唯一正式真值。
- LocalStorage 只保存離線草稿、同步佇列與非正式快取。

## 第一階段元件

```text
src/core/       資料模型、驗證、排程與消毒
src/admin/      私有管理台 UI
src/setup/      設定精靈
src/gas-admin/  Apps Script 伺服器端 API
```

公開報名頁、跨網域帳號與學校專屬行政表單不在第一階段核心內。

## 角色

| 角色 | 權限 |
|---|---|
| owner | 全部課程資料、設定與使用者管理 |
| editor | 編輯講者、場次與待辦，不可管理使用者與系統設定 |
| denied | 不得取得任何課程資料 |

UI 隱藏按鈕不算權限控制；所有 API 必須在伺服器端重新檢查角色。

