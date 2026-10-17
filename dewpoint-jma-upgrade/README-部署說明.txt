東京露點監測器 Netlify 部署包

1. 在 Netlify 進入原有專案 regal-sunflower-a5b989。
2. 到 Deploys / Deploy manually（或 Production deploys 的拖放區）。
3. 建議在電腦上使用 Netlify CLI 或 Git 儲存庫部署，確保 Netlify Functions 一起發布。
4. 若使用 Netlify Drop，請先確認 Functions 是否被處理；單純靜態拖放可能不會部署函式。
5. 部署後先檢查 /.netlify/functions/tokyo-weather 能否回傳 JSON，再測試首頁。

可靠的部署方式：安裝 Node.js，執行 npm install -g netlify-cli，解壓縮後在資料夾內執行 netlify login，再執行 netlify deploy --prod --dir=. --functions=netlify/functions --site=<現有 site id>。
或將資料夾上傳 GitHub repo 並在 Netlify 連結該 repo（推薦手機操作）。

注意：自動模式需要網路；JMA JSON 是網站使用的資料介面，未承諾穩定性。
