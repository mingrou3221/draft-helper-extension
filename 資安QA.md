# 底稿小幫手 — 資安 Q&A

---

### Q1：這個插件會把我的資料上傳到外部伺服器嗎？

**不會。** 插件完全沒有任何網路請求（沒有 `fetch`、`XMLHttpRequest`、`WebSocket` 等）。所有資料都儲存在使用者本機的 Chrome 瀏覽器內部（`chrome.storage.local`），不會離開使用者的電腦。

---

### Q2：插件需要哪些權限？有沒有過度授權？

插件只申請了 **2 個最小權限**：

| 權限 | 用途 | 風險 |
|------|------|------|
| `storage` | 儲存使用者建立的文字資料到本機 | 無風險，僅限插件自身存取 |
| `clipboardWrite` | 將文字複製到剪貼簿 | 無風險，僅寫入剪貼簿 |

**沒有** 申請以下高風險權限：
- ❌ `tabs` — 無法讀取瀏覽器分頁資訊
- ❌ `history` — 無法讀取瀏覽歷史
- ❌ `cookies` — 無法存取任何 Cookie
- ❌ `webRequest` — 無法攔截或修改網路請求
- ❌ `<all_urls>` — 無法存取任何網頁內容
- ❌ `clipboardRead` — 無法讀取剪貼簿中的現有內容

---

### Q3：插件能讀取我正在瀏覽的網頁內容嗎？

**不能。** 插件沒有任何 Content Script（注入網頁的腳本），也沒有申請任何網頁存取權限。它完全無法讀取、修改或監控使用者瀏覽的任何網頁。

---

### Q4：插件有背景執行的程式嗎？會不會偷偷在背景運作？

**沒有。** 插件沒有 Background Script / Service Worker。它只在使用者主動點擊插件圖示、打開彈出視窗時才會執行，關閉彈出視窗後程式即停止。

---

### Q5：匯入的 JSON 資料儲存在哪裡？誰可以存取？

資料儲存在 Chrome 瀏覽器的本機儲存空間（LevelDB 資料庫），位於：

- **Mac**：`~/Library/Application Support/Google/Chrome/Default/Local Extension Settings/<extension-id>/`
- **Windows**：`%LOCALAPPDATA%\Google\Chrome\User Data\Default\Local Extension Settings\<extension-id>\`

**存取權限**：
- 只有此插件自身可以透過 API 存取
- 其他插件**無法**存取此插件的資料（Chrome 的沙箱隔離機制）
- 只有擁有電腦管理權限的人可以直接讀取該資料夾

---

### Q6：移除插件後資料會殘留嗎？

**不會。** 使用者從 Chrome 移除此插件時，`chrome.storage.local` 中的所有資料會被 Chrome 自動清除，不會殘留。

---

### Q7：插件有沒有 XSS（跨站腳本攻擊）的風險？

**已防護。** 所有使用者輸入的文字在渲染到畫面時，都經過 `escHtml()` 函數進行 HTML 跳脫處理（`&`, `<`, `>`, `"` 皆被轉義），防止惡意腳本注入。

---

### Q8：匯入的 JSON 有沒有被注入惡意程式碼的風險？

**風險極低。** 匯入流程有以下防護：
1. 使用 `JSON.parse()` 嚴格解析，非合法 JSON 會直接拒絕
2. 解析後驗證資料必須是陣列格式
3. 匯入前顯示確認視窗，告知現有資料筆數與即將匯入筆數，需使用者主動確認才執行
4. 所有資料在渲染時都經過 HTML 跳脫處理，即使 JSON 中含有 `<script>` 標籤也不會被執行

---

### Q9：使用 Manifest V3 有什麼安全優勢？

此插件採用 Chrome 最新的 **Manifest V3** 規範，具備以下安全特性：
- 不允許執行遠端程式碼（Remote Code Execution）
- 更嚴格的權限控管與 CSP（Content Security Policy）
- 所有程式碼皆為本地靜態檔案，可供審閱

---

### Q10：這個插件的資料會跨裝置同步嗎？

**不會。** 插件使用的是 `chrome.storage.local`（本機儲存），而非 `chrome.storage.sync`（同步儲存）。資料僅存在於安裝該插件的單一裝置上，不會透過 Google 帳號同步到其他裝置。

---

### Q11：更新插件版本後，原本的資料還在嗎？

**會保留。** `chrome.storage.local` 的資料與版本號無關，只要是同一個 Extension ID 的更新，資料完全不受影響。資料只有在使用者主動解除安裝插件時才會被清除。

---

### 總結

| 項目 | 狀態 |
|------|------|
| 網路連線 | 完全離線，無任何對外連線 |
| 資料儲存 | 僅本機，不上傳 |
| 權限範圍 | 最小權限（storage + clipboardWrite） |
| 網頁存取 | 無法存取任何網頁內容 |
| 背景執行 | 無背景程式 |
| XSS 防護 | 有（HTML 跳脫處理） |
| 匯入確認保護 | 有（顯示筆數確認視窗） |
| 架構規範 | Manifest V3（最新安全標準） |
