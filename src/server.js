const path = require('path');
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const { fetchXeLuotToanTrungCars } = require('./scrapers/xeluottoantrung');
const { fetchOtoAnhLuongCars } = require('./scrapers/otoanhluong');

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 15 * 60 * 1000);
const tasks = [
  { id: 'xeluottoantrung', name: 'Xe Lướt Toàn Trung', loader: fetchXeLuotToanTrungCars },
  { id: 'otoanhluong', name: 'Anh Lượng Auto', loader: fetchOtoAnhLuongCars }
];

let cache = { cars: [], fetchedAt: 0, sources: [], errors: [] };

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
  const isCacheValid = !shouldRefresh && cache.cars.length && Date.now() - cache.fetchedAt < CACHE_TTL_MS;

  if (isCacheValid) {
    return res.json(buildPayload(cache));
  }

  try {
    const snapshot = await collectCars();
    cache = { ...snapshot, fetchedAt: Date.now() };
    return res.json(buildPayload(cache));
  } catch (error) {
    console.error('Không thể tải dữ liệu xe:', error);
    if (cache.cars.length) {
      return res.status(200).json(buildPayload(cache));
    }
    return res.status(500).json({ error: 'Không thể lấy dữ liệu xe. Vui lòng thử lại sau.' });
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
});
