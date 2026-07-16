# Security Policy

## 支援版本

目前仍是 alpha，安全修正只套用到最新版本。

## 回報安全問題

請不要在公開 issue 貼出講者資料、Google Sheet ID、deployment URL、OAuth token 或其他憑證。請使用 GitHub repository 的私人安全通報功能；若尚未啟用，請直接聯絡 repository owner。

## 信任邊界

- 第一階段只支援同一 Google Workspace 網域。
- Google 部署層限制網域；應用程式再以 `Users` 白名單授權。
- 所有寫入 API 必須在伺服器端驗證角色、revision 與 row version。
- 本專案不提供中央資料庫，也不接收安裝者的課程資料。
