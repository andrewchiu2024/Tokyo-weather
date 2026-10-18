Tokyo Meteo — Cloudflare Pages 測試版

重要：這是獨立測試資料夾，不要覆蓋原本 Netlify 專案。

1. 將整個資料夾 cloudflare-preview 上傳至 GitHub 的 Tokyo-weather 倉庫（建議新建 cloudflare-preview/）。
2. Cloudflare Dashboard > Workers & Pages > Create > Pages > Connect to Git。選擇 Tokyo-weather。
3. Build command 留空；Build output directory 填 cloudflare-preview；Root directory 填 cloudflare-preview（如介面要求）。若 Root directory 已是 cloudflare-preview，Build output directory 應填 . 。請確保輸出包含 index.html 與 functions/ 資料夾。
4. Pages > Settings > Variables and Secrets 新增 CWA_API_KEY，值填入你原本的 CWA 授權碼。Production 與 Preview 如需要均設定。不要把金鑰寫入 GitHub。
5. 重新部署後測試：/api/tokyo-weather、/api/sapporo-weather、/api/city-weather?city=taipei、/api/weather-condition?city=tokyo。
6. 前端 API 路徑已改為 /api/；Netlify 舊網站完全不受影響。

注意：Cloudflare 的 Git 部署與 Functions 需要在 Cloudflare 上實際測試；本套件僅完成靜態及語法檢查。
