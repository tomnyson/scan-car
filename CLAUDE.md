# CLAUDE.md — Hướng dẫn code cho project Scan Car

File này định hướng cách Claude Code làm việc trong repo này. Đọc trước khi sửa code.

## Tổng quan project

- **Mục tiêu**: Thu thập dữ liệu xe ô tô từ nhiều nguồn (xeluottoantrung, otoanhluong, bonbanh, chotot, VnExpress V-Car), chuẩn hóa và phục vụ qua API + web UI.
- **Stack**: Node.js + Express 5, Cheerio (scrape HTML), MongoDB (`mongodb` driver), SQLite (`data/crawler.db`), `node-cron` cho job định kỳ, vanilla HTML/CSS/JS (không framework FE).
- **Ngôn ngữ**: JavaScript thuần (không TypeScript). CommonJS (`require`).
- **Chạy dev**: `npm run dev` (nodemon). Chạy prod: `npm run start`. Mặc định port `3000`.

## Cấu trúc thư mục

```
api/
└── index.js             # Vercel serverless entry, re-export Express app từ src/server.js
src/
├── server.js            # Express app + route + cache logic; nếu isVercel thì KHÔNG listen
├── mongo.js             # Kết nối Mongo + các hàm truy vấn/lưu snapshot
├── scrapers/            # Mỗi file là 1 nguồn scrape độc lập
│   ├── xeluottoantrung.js
│   ├── otoanhluong.js
│   ├── bonbanh.js
│   ├── chotot.js
│   ├── vcar.js
│   └── trafficfine.js
└── utils/
    └── brand.js         # Chuẩn hóa hãng xe
public/                  # UI tĩnh (index.html, admin.html, app.js, styles.css…)
cache/                   # Cache JSON của kết quả scrape (chỉ dùng local)
data/                    # SQLite legacy (không active)
vercel.json              # Rewrites + Vercel Cron
```

## Quy ước code

### Style JavaScript

- Dùng `const` mặc định, `let` khi bắt buộc reassign. **Không** dùng `var`.
- Async/await ở mọi nơi có I/O. Không mix Promise `.then` với `await` trong cùng function.
- Bọc mọi lời gọi mạng, DB, filesystem bằng `try/catch` và log lỗi rõ ràng bằng tiếng Việt (đồng nhất với style hiện tại: `console.warn('Không thể ...:', error.message)`).
- Không mutate object đầu vào. Trả về object mới bằng spread (`{ ...obj, field: value }`).
- Function nhỏ, tập trung 1 việc. File `< 800 dòng`; nếu vượt → tách module.
- Không thêm `console.log` debug vào code merge; chỉ giữ `console.warn` / `console.error` cho lỗi thật sự.

### Scraper (`src/scrapers/*.js`)

- Mỗi scraper **export** 2 hàm chuẩn: `fetchXxxCars()` trả về danh sách xe đã chuẩn hóa, và `fetchXxxCarDetail(url)` (nếu có).
- Trả về schema xe đã chuẩn hóa để `server.js` gộp thẳng. Tối thiểu: `id`, `source`, `title`, `price`, `url`, `image`, `location`, `year`, `mileage`, `updatedAt`.
- Set `User-Agent` giả trình duyệt để tránh bị chặn. Retry / delay khi cần, không spam site nguồn.
- **Không hard-code URL nhạy cảm hoặc token** trong scraper. Config qua env nếu cần thay đổi.
- Khi thêm nguồn mới:
  1. Thêm file `src/scrapers/<ten-nguon>.js`.
  2. Đăng ký trong `tasks` và `SOURCE_CONFIG` ở `src/server.js`.
  3. Nếu có trang chi tiết, thêm vào `detailFetchers`.

#### Bonbanh — crawl toàn site

- Entry: `bonbanh.com/oto` (~1450 trang, ~29k tin active). Config qua `BONBANH_LIST_URL`.
- Pagination detect qua `<link rel="next">`. Mỗi lần chạy crawl `BONBANH_MAX_PAGES` trang (mặc định 5) từ trang mới nhất.
- Không thể crawl toàn bộ 1450 trang trong 1 Vercel invocation (60s max). Tin mới nhất được refresh hằng ngày; tin cũ hơn cần tăng `BONBANH_MAX_PAGES` khi tự host hoặc chạy manual.
- Delay `BONBANH_PAGE_DELAY_MS` (mặc định 500ms + jitter) giữa các page — tôn trọng site nguồn.
- Legacy `fetchBonbanhSalonCars()` (crawl salon Đắk Lắk) vẫn export nhưng không dùng mặc định.

### Cache

- **Local**: file JSON `cache/cars-cache.json`, TTL từ env `CACHE_TTL_MS` (mặc định 2h).
- **Vercel**: filesystem read-only → `loadCacheFromDisk`/`persistCacheToDisk` auto no-op. **MongoDB là source of truth**: cold start gọi `hydrateFromMongo()` → `getLatestSnapshot()` để nạp `cache` in-memory.
- Query `/api/cars?refresh=true` phải bypass cache — giữ contract này.
- Không đọc/ghi cache đồng bộ ngoài lần khởi động; runtime dùng `fs.promises`.

### MongoDB (`src/mongo.js`)

- Dùng chung 1 client, gọi `initMongo()` một lần lúc boot.
- Các hàm public (`saveSnapshot`, `getUserCars`, ...) đã ổn định — thay đổi phải giữ signature hoặc cập nhật đồng bộ chỗ gọi trong `server.js`.
- Truy vấn phải parametrize (không nối chuỗi thủ công).

### Express routes (`src/server.js`)

- Middleware bảo mật: `helmet` + `compression` đã bật. Không tắt nếu không có lý do.
- Route trả JSON theo dạng: `{ updatedAt, count, sources, errors, data }` — theo README, giữ contract.
- Route admin/upload cần validate input & giới hạn kích thước (`multer`).
- Cron job: lịch từ env `CRON_SCHEDULE` (mặc định `0 3 * * *`, TZ `Asia/Ho_Chi_Minh`). Đừng chạy job nặng ngoài cron/route refresh.

### Frontend (`public/`)

- Vanilla JS, không bundler. Sửa `app.js`, `index.html`, `styles.css` trực tiếp.
- Không nạp thư viện qua CDN mới nếu chưa cần; nếu buộc phải thêm, dùng SRI.
- Giữ giao diện responsive, dùng CSS variable đã có trong `styles.css` thay vì hardcode màu/spacing.

## Bảo mật (bắt buộc)

- File `.env` **không commit** (kiểm tra `.gitignore` trước khi add).
- Không hardcode Mongo URI, API key, token trong source. Đọc từ `process.env.*` và fail sớm nếu thiếu.
- Validate mọi input người dùng (query, body, file upload). Từ chối payload lạ với 400.
- Escape dữ liệu khi render ra HTML từ scraper (đề phòng XSS khi hiển thị `title`, `description`…).

## Deploy Vercel

- `vercel.json` khai báo rewrites (`/api/*` và tất cả path không có extension → `api/index.js`) và **Vercel Cron** gọi `/api/cron/refresh` mỗi 6h.
- Endpoint `/api/cron/refresh` bảo vệ bằng header `Authorization: Bearer $CRON_SECRET`. Vercel Cron tự động inject header này.
- Env cần config trên Vercel: `MONGO_URL`, `MONGO_DB`, `MONGO_COLLECTION`, `ADMIN_KEY`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`.
- Upload ảnh: local → multer disk (`public/uploads/`); Vercel → `multer.memoryStorage()` + `@vercel/blob.put()` (URL public).
- `node-cron` chỉ chạy khi tự host (không phải Vercel). Trên Vercel, cron duy nhất là Vercel Cron trong `vercel.json`.
- Khi thêm env mới: cập nhật `env copy.sample` **và** Vercel dashboard.

## Quy trình làm việc

1. **Trước khi code**: đọc code hiện tại của module liên quan (`server.js`, scraper tương ứng) để giữ đúng convention.
2. **Đổi ít nhất có thể**: sửa đúng phần cần sửa, không refactor kèm ngoài phạm vi yêu cầu.
3. **Test tay**: chạy `npm run dev`, thử endpoint bằng `curl "http://localhost:3000/api/cars?refresh=true"` và kiểm tra UI.
4. **Commit**: message tiếng Việt hoặc tiếng Anh đều được, dạng `<type>: <mô tả>` (feat/fix/refactor/chore/docs). Không tự push khi user chưa yêu cầu.

## Những điều KHÔNG làm

- Không đổi sang TypeScript, không thêm framework FE (React/Vue) trừ khi user yêu cầu.
- Không thay `mongodb` driver bằng ORM.
- Không thêm dependency mới nếu chưa hỏi user — dependencies hiện tại là tối thiểu có chủ đích.
- Không xóa cache/DB, không chạy `git reset --hard`, `git push --force` khi chưa được yêu cầu.
- Không tạo file `.md` mới (planning, notes…) trừ khi user yêu cầu rõ.

## Khi bí

- Hỏi user thay vì đoán schema dữ liệu hoặc URL nguồn mới.
- Với scraper hỏng: kiểm tra HTML thật của trang nguồn bằng `curl` trước, đừng đoán selector.
