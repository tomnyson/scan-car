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
const { initMongo, saveSnapshot, saveNewCarSnapshot } = require('./mongo');

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
  const snapshot = await collectCars();
  cache = { ...snapshot, fetchedAt: Date.now() };
  await persistCacheToDisk(cache);
  if (mongoReady) {
    saveSnapshot(cache).catch((error) => {
      console.error('Không lưu được snapshot Mongo:', error.message);
    });
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
    return res.json(buildPayload(cache));
  }

  try {
    await refreshCache();
    return res.json(buildPayload(cache));
  } catch (error) {
    console.error('Không thể tải dữ liệu xe:', error);
    if (hasCache) {
      return res.status(200).json(buildPayload(cache));
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
