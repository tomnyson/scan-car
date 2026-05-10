require('dotenv').config();
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const cron = require('node-cron');
const { fetchXeLuotToanTrungCars, fetchXeLuotToanTrungCarDetail } = require('./scrapers/xeluottoantrung');
const { fetchOtoAnhLuongCars, fetchOtoAnhLuongCarDetail } = require('./scrapers/otoanhluong');
const { fetchBonbanhCars, fetchBonbanhCarDetail } = require('./scrapers/bonbanh');
const { fetchChototCars, fetchChototCarDetail } = require('./scrapers/chotot');
const { fetchVCarPrices } = require('./scrapers/vcar');
const { checkTrafficFine } = require('./scrapers/trafficfine');
const { initMongo, saveSnapshot, saveNewCarSnapshot, saveUserCar, getUserCars, deleteUserCar, getPendingUserCars, approveUserCar, rejectUserCar, toggleUserCarVisibility, updateUserCar } = require('./mongo');

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 2 * 60 * 60 * 1000);
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 3 * * *';
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'Asia/Ho_Chi_Minh';
const CACHE_FILE_PATH = path.join(__dirname, '../cache/cars-cache.json');
const tasks = [
  { id: 'xeluottoantrung', name: 'Xe Lướt Toàn Trung', loader: fetchXeLuotToanTrungCars },
  { id: 'otoanhluong', name: 'Anh Lượng Auto', loader: fetchOtoAnhLuongCars },
  { id: 'bonbanh', name: 'Bonbanh Đắk Lắk', loader: fetchBonbanhCars },
  { id: 'chotot', name: 'Chợ Tốt (BMT)', loader: fetchChototCars },
  { id: 'vcar', name: 'VnExpress V-Car', loader: fetchVCarPrices }
];
const SOURCE_CONFIG = {
  xeluottoantrung: {
    baseUrl: 'https://xeluottoantrung.com/',
    hosts: ['xeluottoantrung.com', 'www.xeluottoantrung.com']
  },
  otoanhluong: {
    baseUrl: 'https://otoanhluong.vn/',
    hosts: ['otoanhluong.vn', 'www.otoanhluong.vn']
  },
  bonbanh: {
    baseUrl: 'https://bonbanh.com/',
    hosts: ['bonbanh.com']
  },
  chotot: {
    baseUrl: 'https://xe.chotot.com/',
    hosts: ['xe.chotot.com', 'chotot.com', 'www.chotot.com']
  },
  vcar: {
    baseUrl: 'https://vnexpress.net/oto-xe-may/v-car',
    hosts: ['vnexpress.net', 'www.vnexpress.net']
  }
};
const detailFetchers = {
  xeluottoantrung: fetchXeLuotToanTrungCarDetail,
  otoanhluong: fetchOtoAnhLuongCarDetail,
  bonbanh: fetchBonbanhCarDetail,
  chotot: fetchChototCarDetail
};
const detailCache = new Map();

const createEmptyCache = () => ({ cars: [], fetchedAt: 0, sources: [], errors: [] });

const loadCacheFromDisk = () => {
  try {
    if (!fs.existsSync(CACHE_FILE_PATH)) {
      return createEmptyCache();
    }
    const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf8');
    if (!raw) return createEmptyCache();

    const parsed = JSON.parse(raw);
    return {
      cars: Array.isArray(parsed.cars) ? parsed.cars : [],
      fetchedAt: Number(parsed.fetchedAt) || 0,
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      errors: Array.isArray(parsed.errors) ? parsed.errors : []
    };
  } catch (error) {
    console.warn('Không thể đọc cache từ file:', error.message);
    return createEmptyCache();
  }
};

const persistCacheToDisk = async (snapshot) => {
  try {
    await fsPromises.mkdir(path.dirname(CACHE_FILE_PATH), { recursive: true });
    await fsPromises.writeFile(CACHE_FILE_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
  } catch (error) {
    console.warn('Không thể lưu cache ra file:', error.message);
  }
};

let cache = loadCacheFromDisk();
const DETAIL_CACHE_TTL_MS = CACHE_TTL_MS;
let mongoReady = false;

const normalizeHost = (value = '') => value.trim().toLowerCase().replace(/^www\./, '');
const matchesHost = (host, candidate) => host === candidate || host.endsWith(`.${candidate}`);
const isHostAllowedForSource = (source, host) => {
  const config = SOURCE_CONFIG[source];
  if (!config) return false;
  return config.hosts.some((candidate) => matchesHost(host, candidate));
};

const detectSourceFromUrl = (value = '') => {
  try {
    const parsed = new URL(value);
    const host = normalizeHost(parsed.hostname);
    return Object.entries(SOURCE_CONFIG).find(([, config]) => config.hosts.some((candidate) => matchesHost(host, candidate)))?.[0] || null;
  } catch (error) {
    return null;
  }
};

const normalizeDetailUrl = (source, rawUrl) => {
  try {
    return new URL(rawUrl).href;
  } catch (error) {
    const base = SOURCE_CONFIG[source]?.baseUrl;
    if (!base) {
      throw new Error('Nguồn không được hỗ trợ');
    }
    return new URL(rawUrl, base).href;
  }
};

const getDetailCacheEntry = (key) => {
  const entry = detailCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > DETAIL_CACHE_TTL_MS) {
    detailCache.delete(key);
    return null;
  }
  return entry.data;
};

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false
  })
);
app.use(compression());
app.use(express.json());

const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir, { maxAge: '1h' }));

async function collectCars() {
  const settled = await Promise.allSettled(tasks.map((task) => task.loader()));
  const cars = [];
  const sourceStates = [];
  const errors = [];

  settled.forEach((result, index) => {
    const meta = tasks[index];
    if (result.status === 'fulfilled') {
      const items = Array.isArray(result.value) ? result.value : [];
      cars.push(...items);
      sourceStates.push({ id: meta.id, name: meta.name, count: items.length, status: 'ok' });
    } else {
      const message = result.reason?.message || 'Không lấy được dữ liệu';
      errors.push({ id: meta.id, message });
      sourceStates.push({ id: meta.id, name: meta.name, count: 0, status: 'error' });
    }
  });

  cars.sort((a, b) => a.title.localeCompare(b.title, 'vi'));
  return { cars, sources: sourceStates, errors };
}

const startRefresh = async () => {
  console.log(`[Refresh] Starting data collection...`);
  const snapshot = await collectCars();
  cache = { ...snapshot, fetchedAt: Date.now() };

  console.log(`[Refresh] Collected ${snapshot.cars.length} cars, saving to disk...`);
  await persistCacheToDisk(cache);

  if (mongoReady) {
    console.log(`[Refresh] MongoDB ready, saving ${cache.cars.length} cars to database...`);
    try {
      await saveSnapshot(cache);
      console.log(`[Refresh] Successfully saved to MongoDB`);
    } catch (error) {
      console.error('[Refresh] Không lưu được snapshot Mongo:', error.message);
    }
  } else {
    console.warn('[Refresh] MongoDB not ready, skipping database save');
  }

  return cache;
};


let refreshPromise = null;
const refreshCache = () => {
  if (!refreshPromise) {
    refreshPromise = startRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
};

function buildPayload(snapshot, fallbackDate = Date.now()) {
  return {
    updatedAt: new Date(snapshot.fetchedAt || fallbackDate).toISOString(),
    count: snapshot.cars.length,
    sources: snapshot.sources,
    errors: snapshot.errors,
    data: snapshot.cars
  };
}

// Build payload with community cars included
async function buildPayloadWithCommunity(snapshot, fallbackDate = Date.now()) {
  // Get approved community cars from MongoDB
  let communityCars = [];
  try {
    communityCars = await getUserCars({ status: 'approved' });
  } catch (err) {
    console.error('[API] Error fetching community cars:', err.message);
  }

  // Merge with scraped cars (avoid duplicates by id)
  const existingIds = new Set(snapshot.cars.map(c => c.id));
  const newCommunity = communityCars.filter(c => !existingIds.has(c.id));
  const allCars = [...snapshot.cars, ...newCommunity];

  // Add community source if there are community cars
  let sources = [...(snapshot.sources || [])];
  if (newCommunity.length > 0) {
    const hasCommunitySrc = sources.some(s => s.id === 'community');
    if (!hasCommunitySrc) {
      sources.push({ id: 'community', name: 'Cộng đồng', count: newCommunity.length, status: 'ok' });
    }
  }

  return {
    updatedAt: new Date(snapshot.fetchedAt || fallbackDate).toISOString(),
    count: allCars.length,
    sources,
    errors: snapshot.errors,
    data: allCars
  };
}

app.get('/api/cars', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const shouldRefresh = req.query.refresh === 'true';
  const hasCache = cache.cars.length > 0;
  const isFresh = hasCache && Date.now() - cache.fetchedAt < CACHE_TTL_MS;

  if (!shouldRefresh && hasCache) {
    if (!isFresh) {
      res.set('X-Data-Stale', 'true');
      refreshCache().catch((error) => {
        console.error('Không thể làm mới cache nền:', error);
      });
    }
    return res.json(await buildPayloadWithCommunity(cache));
  }

  try {
    await refreshCache();
    return res.json(await buildPayloadWithCommunity(cache));
  } catch (error) {
    console.error('Không thể tải dữ liệu xe:', error);
    if (hasCache) {
      return res.status(200).json(await buildPayloadWithCommunity(cache));
    }
    return res.status(500).json({ error: 'Không thể lấy dữ liệu xe. Vui lòng thử lại sau.' });
  }
});

app.get('/api/new-cars', async (req, res) => {
  const forceRefresh = req.query.refresh === 'true';
  const now = Date.now();
  const cachedVCar = cache.cars.filter((car) => car.source === 'vcar');
  const hasCache = cachedVCar.length > 0;
  const isFresh = hasCache && now - cache.fetchedAt < CACHE_TTL_MS;

  if (!forceRefresh && isFresh) {
    return res.json({
      updatedAt: new Date(cache.fetchedAt).toISOString(),
      count: cachedVCar.length,
      data: cachedVCar,
      cached: true
    });
  }

  try {
    const data = await fetchVCarPrices();
    const snapshot = {
      fetchedAt: Date.now(),
      data: Array.isArray(data) ? data : [],
      count: Array.isArray(data) ? data.length : 0,
      source: 'vcar'
    };
    if (mongoReady) {
      saveNewCarSnapshot(snapshot).catch((error) => {
        console.warn('Không lưu được giá xe mới vào Mongo:', error.message);
      });
    }
    return res.json({
      updatedAt: new Date(snapshot.fetchedAt).toISOString(),
      count: snapshot.count,
      data: snapshot.data
    });
  } catch (error) {
    console.error('Không thể tải giá xe mới:', error);
    if (isFresh) {
      return res.json({
        updatedAt: new Date(cache.fetchedAt).toISOString(),
        count: cachedVCar.length,
        data: cachedVCar,
        cached: true,
        error: error.message || 'Không thể làm mới dữ liệu'
      });
    }
    return res.status(500).json({ error: 'Không thể lấy giá xe mới. Vui lòng thử lại sau.' });
  }
});

app.get('/api/cars/detail', async (req, res) => {
  const rawUrl = String(req.query.url || '').trim();
  let source = String(req.query.source || '').trim().toLowerCase();

  if (!rawUrl) {
    return res.status(400).json({ error: 'Thiếu tham số url' });
  }
  if (!source) {
    source = detectSourceFromUrl(rawUrl);
  }
  if (!source || !detailFetchers[source]) {
    return res.status(400).json({ error: 'Nguồn không được hỗ trợ' });
  }

  let normalizedUrl;
  try {
    normalizedUrl = normalizeDetailUrl(source, rawUrl);
  } catch (error) {
    return res.status(400).json({ error: 'URL không hợp lệ' });
  }

  let parsed;
  try {
    parsed = new URL(normalizedUrl);
  } catch (error) {
    return res.status(400).json({ error: 'URL không hợp lệ' });
  }

  const host = normalizeHost(parsed.hostname);
  if (!isHostAllowedForSource(source, host)) {
    return res.status(400).json({ error: 'URL không thuộc nguồn hợp lệ' });
  }

  const cacheKey = `${source}|${parsed.href}`;
  const cached = getDetailCacheEntry(cacheKey);
  if (cached) {
    return res.json({ data: cached, cached: true });
  }

  try {
    const fetcher = detailFetchers[source];
    if (!fetcher) {
      return res.status(400).json({ error: 'Nguồn không được hỗ trợ' });
    }
    const data = await fetcher(parsed.href);
    detailCache.set(cacheKey, { data, fetchedAt: Date.now() });
    return res.json({ data });
  } catch (error) {
    console.error('Không thể tải chi tiết xe:', error);
    return res.status(500).json({ error: 'Không thể lấy chi tiết xe. Vui lòng thử lại sau.' });
  }
});

app.post('/api/check-fine', async (req, res) => {
  const { licensePlate, captcha } = req.body;

  if (!licensePlate) {
    return res.status(400).json({
      success: false,
      error: 'Vui lòng nhập biển số xe'
    });
  }

  try {
    const result = await checkTrafficFine(licensePlate, captcha);
    return res.json(result);
  } catch (error) {
    console.error('Lỗi kiểm tra phạt nguội:', error);
    return res.status(400).json({
      success: false,
      error: error.message || 'Không thể kiểm tra phạt nguội. Vui lòng thử lại sau.'
    });
  }
});

// ========== USER CAR SUBMISSION ENDPOINTS ==========

// POST /api/user-cars - Đăng xe mới
app.post('/api/user-cars', async (req, res) => {
  try {
    const { title, brand, year, priceText, mileage, phone, description, thumbnail, images } = req.body;

    // Validation
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Vui lòng nhập tên xe' });
    }
    if (!phone || !phone.trim()) {
      return res.status(400).json({ success: false, error: 'Vui lòng nhập số điện thoại liên hệ' });
    }
    if (!priceText || !priceText.trim()) {
      return res.status(400).json({ success: false, error: 'Vui lòng nhập giá bán' });
    }

    // Phone validation (Vietnamese format)
    const phoneClean = phone.replace(/\s+/g, '').replace(/[-.]/g, '');
    if (!/^(0|\+84)[0-9]{9,10}$/.test(phoneClean)) {
      return res.status(400).json({ success: false, error: 'Số điện thoại không hợp lệ' });
    }

    const carData = {
      title: title.trim(),
      brand: (brand || '').trim(),
      year: year ? parseInt(year) : null,
      priceText: priceText.trim(),
      mileage: mileage ? parseInt(mileage) : null,
      phone: phoneClean,
      description: (description || '').trim(),
      thumbnail: (thumbnail || '').trim(),
      images: Array.isArray(images) ? images : []
    };

    const savedCar = await saveUserCar(carData);

    return res.status(201).json({
      success: true,
      message: 'Đăng xe thành công!',
      data: savedCar
    });
  } catch (error) {
    console.error('Lỗi đăng xe:', error);
    return res.status(500).json({
      success: false,
      error: 'Không thể đăng xe. Vui lòng thử lại sau.'
    });
  }
});

// GET /api/user-cars - Lấy danh sách xe đã đăng
app.get('/api/user-cars', async (req, res) => {
  try {
    const { phone, limit } = req.query;
    const options = {
      phone: phone || undefined,
      limit: limit ? parseInt(limit) : 100
    };

    const cars = await getUserCars(options);

    return res.json({
      success: true,
      count: cars.length,
      data: cars
    });
  } catch (error) {
    console.error('Lỗi lấy danh sách xe người dùng:', error);
    return res.status(500).json({
      success: false,
      error: 'Không thể lấy danh sách xe.'
    });
  }
});

// DELETE /api/user-cars/:id - Xóa xe đã đăng
app.delete('/api/user-cars/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, error: 'Vui lòng cung cấp số điện thoại để xác thực' });
    }

    const deleted = await deleteUserCar(id, phone);

    if (deleted) {
      return res.json({ success: true, message: 'Đã xóa xe thành công' });
    } else {
      return res.status(404).json({ success: false, error: 'Không tìm thấy xe hoặc số điện thoại không khớp' });
    }
  } catch (error) {
    console.error('Lỗi xóa xe:', error);
    return res.status(500).json({ success: false, error: 'Không thể xóa xe.' });
  }
});

// ========== FILE UPLOAD ==========
const multer = require('multer');
const UPLOAD_DIR = path.join(__dirname, '../public/uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (allowed.test(ext) && allowed.test(file.mimetype.split('/')[1])) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận file hình ảnh (jpg, png, gif, webp)'));
    }
  }
});

// POST /api/upload - Upload multiple images
app.post('/api/upload', upload.array('images', 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'Không có file nào được upload' });
    }

    const urls = req.files.map(f => `/uploads/${f.filename}`);
    return res.json({
      success: true,
      count: urls.length,
      urls
    });
  } catch (error) {
    console.error('Lỗi upload:', error);
    return res.status(500).json({ success: false, error: error.message || 'Không thể upload file' });
  }
});

// ========== ADMIN ENDPOINTS ==========
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123'; // Simple auth key

const adminAuth = (req, res, next) => {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
};

// GET /api/admin/pending-cars - Get pending cars for approval
app.get('/api/admin/pending-cars', adminAuth, async (req, res) => {
  try {
    const cars = await getPendingUserCars();
    return res.json({
      success: true,
      count: cars.length,
      data: cars
    });
  } catch (error) {
    console.error('Lỗi lấy tin chờ duyệt:', error);
    return res.status(500).json({ success: false, error: 'Không thể lấy danh sách' });
  }
});

// POST /api/admin/approve/:id - Approve a car
app.post('/api/admin/approve/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const approved = await approveUserCar(id);

    if (approved) {
      return res.json({ success: true, message: 'Đã duyệt tin thành công' });
    } else {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tin' });
    }
  } catch (error) {
    console.error('Lỗi duyệt tin:', error);
    return res.status(500).json({ success: false, error: 'Không thể duyệt tin' });
  }
});

// POST /api/admin/reject/:id - Reject a car
app.post('/api/admin/reject/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const rejected = await rejectUserCar(id, reason || '');

    if (rejected) {
      return res.json({ success: true, message: 'Đã từ chối tin' });
    } else {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tin' });
    }
  } catch (error) {
    console.error('Lỗi từ chối tin:', error);
    return res.status(500).json({ success: false, error: 'Không thể từ chối tin' });
  }
});

// GET /api/admin/approved-cars - Get all approved community cars
app.get('/api/admin/approved-cars', adminAuth, async (req, res) => {
  try {
    const cars = await getUserCars({ status: 'approved' });
    return res.json({
      success: true,
      count: cars.length,
      data: cars
    });
  } catch (error) {
    console.error('Lỗi lấy xe đã duyệt:', error);
    return res.status(500).json({ success: false, error: 'Không thể lấy danh sách' });
  }
});

// POST /api/admin/toggle/:id - Toggle hide/show a car
app.post('/api/admin/toggle/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { hidden } = req.body;
    const toggled = await toggleUserCarVisibility(id, hidden);

    if (toggled) {
      return res.json({
        success: true,
        message: hidden ? 'Đã ẩn tin' : 'Đã hiện tin',
        hidden
      });
    } else {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tin hoặc tin chưa được duyệt' });
    }
  } catch (error) {
    console.error('Lỗi toggle tin:', error);
    return res.status(500).json({ success: false, error: 'Không thể thực hiện' });
  }
});

// GET /api/admin/car/:id - Get single car for editing
app.get('/api/admin/car/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const cars = await getUserCars({});
    const car = cars.find(c => c.id === id);

    if (car) {
      return res.json({ success: true, data: car });
    } else {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tin' });
    }
  } catch (error) {
    console.error('Lỗi lấy tin:', error);
    return res.status(500).json({ success: false, error: 'Không thể lấy tin' });
  }
});

// PUT /api/admin/car/:id - Update a car
app.put('/api/admin/car/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const updated = await updateUserCar(id, updates);

    if (updated) {
      return res.json({ success: true, message: 'Đã cập nhật thành công' });
    } else {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tin' });
    }
  } catch (error) {
    console.error('Lỗi cập nhật tin:', error);
    return res.status(500).json({ success: false, error: 'Không thể cập nhật' });
  }
});


// Endpoint để lấy CAPTCHA từ CSGT
app.get('/api/captcha', (_, res) => {
  try {
    const https = require('https');

    // Đúng URL CAPTCHA của CSGT
    const captchaUrl = 'https://www.csgt.vn/lib/captcha/captcha.class.php?' + Date.now();

    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.csgt.vn/tra-cuu-phuong-tien-vi-pham.html',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    };

    const request = https.get(captchaUrl, options, (response) => {
      res.setHeader('Content-Type', response.headers['content-type'] || 'image/png');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      response.pipe(res);
    });

    request.on('error', (error) => {
      console.error('Lỗi lấy captcha:', error);
      res.status(500).json({ error: 'Không thể lấy captcha' });
    });
  } catch (error) {
    console.error('Lỗi lấy captcha:', error);
    res.status(500).json({ error: 'Không thể lấy captcha' });
  }
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  if (req.method !== 'GET') {
    return next();
  }
  return res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚗  Scan Car server đang chạy tại http://localhost:${PORT}`);
  initMongo()
    .then((result) => {
      mongoReady = result.ok;
      if (!result.ok) {
        console.warn('MongoDB không bật:', result.message);
      } else {
        console.log(result.message);
      }
    })
    .catch((error) => {
      mongoReady = false;
      console.warn('Không thể kết nối Mongo:', error.message);
    });

  // Lịch chạy tự động mỗi ngày 03:00
  if (cron.validate(CRON_SCHEDULE)) {
    console.log(`[Cron] Đăng ký lịch "${CRON_SCHEDULE}" (TZ: ${CRON_TIMEZONE})`);
    cron.schedule(
      CRON_SCHEDULE,
      () => {
        console.log('[Cron] Đang làm mới dữ liệu...');
        refreshCache().catch((error) => console.error('[Cron] Không làm mới được:', error.message));
      },
      { timezone: CRON_TIMEZONE }
    );
  } else {
    console.warn(`[Cron] Biểu thức không hợp lệ: ${CRON_SCHEDULE}`);
  }
});
