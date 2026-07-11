# Scan Car

Ứng dụng Node.js đơn giản thu thập danh sách xe đang bán từ hai nguồn:

- [Xe Lướt Toàn Trung](https://xeluottoantrung.com/san-pham)
- [Anh Lượng Auto](https://otoanhluong.vn/)

Dữ liệu được chuẩn hóa thành API `/api/cars`, đồng thời hiển thị trực quan trên giao diện web kèm bộ lọc, tìm kiếm nhanh.

## Chức năng chính

- Thu thập dữ liệu mỗi khi cần, có cơ chế cache (mặc định 15 phút) để tránh bị chặn.
- Chuẩn hóa dữ liệu, hiển thị nguồn, giá, thông tin bổ sung.
- Bộ lọc theo nguồn và tìm kiếm theo từ khóa ngay trên trình duyệt.
- Nút "Làm mới" buộc hệ thống tải lại dữ liệu mới nhất (`/api/cars?refresh=true`).

## Cách chạy

```bash
npm install
npm run start
```

Trong quá trình phát triển có thể dùng:

```bash
npm run dev
```

Mặc định ứng dụng chạy tại [http://localhost:3000](http://localhost:3000).

## Cấu hình

| Biến môi trường | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `PORT` | `3000` | Cổng chạy máy chủ |
| `CACHE_TTL_MS` | `900000` (15 phút) | Thời gian lưu cache dữ liệu trước khi tự động tải lại |

Tham số `refresh=true` trên endpoint `/api/cars` sẽ bỏ qua cache ngay lập tức.

## Kiểm tra nhanh

Bạn có thể dùng `curl` sau khi khởi động server:

```bash
curl "http://localhost:3000/api/cars?refresh=true"
```

Kết quả trả về gồm thời gian cập nhật (`updatedAt`), tổng số xe (`count`), danh sách nguồn, lỗi (nếu có) và mảng dữ liệu chi tiết.

## Deploy Vercel

Repo đã sẵn sàng chạy trên Vercel (serverless). Các thay đổi chính:
- `api/index.js` là entry serverless, re-export Express app.
- `vercel.json` khai báo rewrites + Vercel Cron gọi `/api/cron/refresh` mỗi 6 giờ.
- Filesystem cache tự động tắt; **MongoDB làm source of truth**.
- Upload ảnh dùng **Vercel Blob** (`@vercel/blob`).

### Cấu hình env trên Vercel

Bắt buộc:

| Biến | Mô tả |
| --- | --- |
| `MONGO_URL` | Connection string MongoDB Atlas |
| `MONGO_DB` | Tên database (mặc định `scan_car`) |
| `MONGO_COLLECTION` | Collection xe (mặc định `cars`) |
| `CRON_SECRET` | Chuỗi ngẫu nhiên dài, bảo vệ endpoint cron |
| `BLOB_READ_WRITE_TOKEN` | Token Vercel Blob (Storage → Blob → Create) |
| `ADMIN_KEY` | Key auth cho `/api/admin/*` |

### Các bước deploy

```bash
npm install                 # cài @vercel/blob
vercel link
vercel env add MONGO_URL production
vercel env add CRON_SECRET production
vercel env add BLOB_READ_WRITE_TOKEN production
vercel env add ADMIN_KEY production
vercel deploy --prod
```

Sau khi deploy, gọi thử `curl -H "Authorization: Bearer $CRON_SECRET" "https://<domain>/api/cron/refresh"` để refresh lần đầu.
# scan-car
