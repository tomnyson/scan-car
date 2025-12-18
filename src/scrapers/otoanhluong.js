const cheerio = require('cheerio');
const { inferBrand } = require('../utils/brand');

const BASE_URL = 'https://otoanhluong.vn/';
const LIST_URL = BASE_URL;
const LOAD_MORE_URL = `${BASE_URL}ajax/ajaxLoadMoreCars.php`;
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Accept-Language': 'vi,en;q=0.9'
};
const FORM_HEADERS = {
  ...REQUEST_HEADERS,
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
};
const SOURCE_NAME = 'Anh Lượng Auto';
const DETAIL_TIMEOUT_MS = Number(process.env.OTOANHLUONG_DETAIL_TIMEOUT_MS || 8000);
const DETAIL_CONCURRENCY = Math.max(1, Number(process.env.OTOANHLUONG_DETAIL_CONCURRENCY || 6));

const ICON_LABEL_MAP = {
  'fa-calendar-alt': 'Năm sản xuất',
  'fa-tachometer-alt': 'ODO',
  'fa-gas-pump': 'Nhiên liệu',
  'fa-car': 'Kiểu dáng'
};

const cleanText = (value = '') => value.replace(/\s+/g, ' ').trim();
const cleanMultiline = (value = '') =>
  value
    .replace(/\r?\n/g, '\n')
    .split('\n')
    .map((line) => cleanText(line))
    .filter(Boolean)
    .join('\n');
const absoluteUrl = (value = '') => {
  if (!value) return '';
  try {
    return new URL(value, BASE_URL).href;
  } catch (error) {
    return value;
  }
};

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractSeatCountFromHtml(html = '') {
  if (!html) return null;
  const $ = cheerio.load(html);
  let seatText = '';
  $('.al-info-car li').each((_, li) => {
    const node = $(li);
    const label = cleanText(node.find('label').text().replace(/:$/, '')).toLowerCase();
    const value = cleanText(node.find('span').text());
    if (!label || !value) return;
    if (label.includes('số chỗ')) {
      seatText = value;
    }
  });
  if (!seatText) return null;
  const match = seatText.match(/(\d{1,2})/);
  if (!match) return null;
  const count = Number(match[1]);
  if (!Number.isFinite(count) || count < 2 || count > 60) return null;
  return count;
}

async function fetchSeatCount(detailUrl) {
  try {
    const response = await fetchWithTimeout(detailUrl, { headers: REQUEST_HEADERS }, DETAIL_TIMEOUT_MS);
    if (!response.ok) return null;
    const html = await response.text();
    return extractSeatCountFromHtml(html);
  } catch (error) {
    return null;
  }
}

async function enrichSeatCounts(cars = []) {
  const queue = cars.filter((car) => car?.url && !Number.isFinite(Number(car.seatCount)));
  if (!queue.length) return;

  const cache = new Map();
  let cursor = 0;

  const worker = async () => {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      const car = queue[index];
      const url = car.url;
      if (!url) continue;
      if (cache.has(url)) {
        const cached = cache.get(url);
        if (cached) car.seatCount = cached;
        continue;
      }
      const seatCount = await fetchSeatCount(url);
      cache.set(url, seatCount);
      if (seatCount) {
        car.seatCount = seatCount;
        car.attributes = Array.isArray(car.attributes) ? car.attributes : [];
        const hasSeatAttr = car.attributes.some((attr) => String(attr?.label || '').toLowerCase().includes('số chỗ'));
        if (!hasSeatAttr) {
          car.attributes.push({ label: 'Số chỗ ngồi', value: String(seatCount) });
        }
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, queue.length) }, () => worker()));
}

function deriveLabel(iconClass = '') {
  const key = iconClass.split(' ').find((token) => token.startsWith('fa-'));
  return ICON_LABEL_MAP[key] || 'Thông tin';
}

function extractTotalCount($) {
  const totalText = cleanText($('#al-car-all span').text());
  if (!totalText) return null;
  const match = totalText.match(/(\d+)/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

function normalizeCar({ id, title, priceText, thumbnail, url, attributes = [], brandInfo = {} }) {
  if (!title) return null;
  return {
    id,
    source: 'otoanhluong',
    sourceName: SOURCE_NAME,
    title,
    priceText: cleanText(priceText),
    thumbnail,
    url,
    attributes,
    brand: brandInfo.brand || '',
    brandSlug: brandInfo.brandSlug || ''
  };
}

function pushUniqueCar(collection, registry, car) {
  if (!car || !car.id) return;
  if (registry.has(car.id)) return;
  registry.add(car.id);
  collection.push(car);
}

async function fetchOtoAnhLuongCars() {
  const response = await fetch(LIST_URL, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    throw new Error(`Anh Lượng trả về mã lỗi ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const cars = [];

  const totalCount = extractTotalCount($);
  const seen = new Set();

  $('ul.al-list-cars li.al-item').each((index, element) => {
    const node = $(element);
    const anchor = node.find('.car-home-tieu-de a.al-car');
    const title = cleanText(anchor.text());
    const href = anchor.attr('href') || '';
    if (!title || !href) return;

    const link = absoluteUrl(href);
    let slug = '';
    try {
      slug = new URL(link).pathname.replace(/^\/+/, '');
    } catch (error) {
      slug = href;
    }

    const imageNode = node.find('.car-home img.al-img-car').first();
    const thumbnail = absoluteUrl(imageNode.attr('src') || '');

    const priceText = cleanText(node.find('.al-box-price .al-price').text());
    const upfront = cleanText(node.find('.al-box-price .tra-truoc-al').text());

    const attributes = [];
    if (upfront) {
      attributes.push({ label: 'Trả trước', value: upfront.replace('Trả trước', '').trim() || upfront });
    }

    node.find('.al-info-car li').each((_, li) => {
      const detail = $(li);
      const iconClass = detail.find('i').attr('class') || '';
      const label = deriveLabel(iconClass);
      const value = cleanText(detail.clone().children('i').remove().end().text());
      if (value) {
        attributes.push({ label, value });
      }
    });

    const brandInfo = inferBrand([slug, title]);

    pushUniqueCar(
      cars,
      seen,
      normalizeCar({
        id: `otoanhluong-${slug || index}`,
        title,
        priceText,
        thumbnail,
        url: link,
        attributes,
        brandInfo
      })
    );
  });

  await loadAdditionalCars({ seen, collection: cars, target: totalCount });
  await enrichSeatCounts(cars);

  return cars;
}

async function loadAdditionalCars({ seen, collection, target }) {
  let nextPage = 1;
  let guard = 0;
  if (target && collection.length >= target) return;

  while (guard < 50) {
    guard += 1;
    const payload = await fetchLoadMorePayload(nextPage);
    if (payload.errorCode && Number(payload.errorCode) !== 0) {
      break;
    }
    const listCars = Array.isArray(payload.listCars) ? payload.listCars : [];

    listCars.forEach((item) => {
      const car = normalizeCar(mapApiCar(item));
      pushUniqueCar(collection, seen, car);
    });

    const reachedTarget = target && collection.length >= target;
    const noMoreData = payload.btn_status === 0 || !listCars.length;
    if (reachedTarget || noMoreData) {
      break;
    }

    const candidate = Number(payload.page);
    if (!Number.isFinite(candidate) || candidate === nextPage) {
      break;
    }
    nextPage = candidate;
  }
}

async function fetchLoadMorePayload(page = 1) {
  const response = await fetch(LOAD_MORE_URL, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: new URLSearchParams({
      page: String(page),
      make_id: '0',
      sort: '',
      action: '2'
    }).toString()
  });

  if (!response.ok) {
    throw new Error(`Anh Lượng load-more lỗi ${response.status}`);
  }

  return response.json();
}

function mapApiCar(item = {}) {
  if (!item) return null;
  const title = cleanText(item.title || item.title_car || '');
  const slug = item.url || item.botvn_car_id || title;
  const brandInfo = inferBrand([item._make_name, slug, title]);
  const id = `otoanhluong-${item.botvn_car_id || slug}`;
  const thumbnail = absoluteUrl(item._image || item.image || '');
  const priceText = cleanText(item.price || '');

  const attributes = [];
  const prepayText = cleanText(item.prepay || '');
  if (prepayText) {
    attributes.push({ label: 'Trả trước', value: prepayText });
  }
  if (item.car_year) {
    attributes.push({ label: 'Năm sản xuất', value: String(item.car_year) });
  }
  if (item.mileage) {
    attributes.push({ label: 'ODO', value: String(item.mileage) });
  }
  if (item.fueltype_id) {
    attributes.push({ label: 'Nhiên liệu', value: String(item.fueltype_id) });
  }
  if (item.body_style_id) {
    attributes.push({ label: 'Kiểu dáng', value: String(item.body_style_id) });
  }

  return {
    id,
    title,
    priceText,
    thumbnail,
    url: absoluteUrl(`Xe-${slug}`),
    attributes,
    brandInfo
  };
}

function extractDetailSummary($) {
  const items = [];
  $('.al-info-car li').each((_, li) => {
    const node = $(li);
    const label = cleanText(node.find('label').text().replace(/:$/, ''));
    const value = cleanText(node.find('span').text());
    if (label || value) {
      items.push({ label: label || 'Thông tin', value: value || label });
    }
  });
  return items;
}

function extractFeeItems($) {
  const items = [];
  $('.al-name-transfer-fee .al-item').each((_, li) => {
    const node = $(li);
    if (node.hasClass('al-title') || node.hasClass('al-choose') || node.hasClass('al-cacu')) {
      return;
    }
    const label = cleanText(node.find('label').text());
    const value = cleanText(node.find('span').text());
    if (label && value) {
      items.push({ label, value });
    }
  });
  return items;
}

function extractGallery($) {
  const gallery = [];
  const seen = new Set();
  $('.al-box-img .al-photo-list').each((_, anchor) => {
    const href = absoluteUrl($(anchor).attr('href'));
    if (href && !seen.has(href)) {
      seen.add(href);
      gallery.push(href);
    }
  });
  return gallery;
}

function extractDescription($) {
  const node = $('.al-car-description').first();
  if (!node.length) return '';
  const clone = node.clone();
  clone.find('script,style,noscript').remove();
  return cleanMultiline(clone.text());
}

function extractContact($) {
  const hotlineNode = $('.al-info-hotline').first();
  const hotline = cleanText(hotlineNode.find('b').text());
  return {
    hotline,
    hotlineLink: hotlineNode.attr('href') || (hotline ? `tel:${hotline.replace(/\s+/g, '')}` : ''),
    hotlineLabel: cleanText(hotlineNode.text()),
    dealer: cleanText($('.al-box-info-salon h3').first().text()),
    address: cleanMultiline($('.al-box-info-salon p').first().text())
  };
}

async function fetchOtoAnhLuongCarDetail(detailUrl) {
  const url = absoluteUrl(detailUrl);
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    throw new Error(`Anh Lượng trả về mã lỗi ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const title = cleanText($('.al-title-car').first().text());
  const priceText = cleanText($('.gia-xe-al').first().text());
  const summary = extractDetailSummary($);
  const sections = [];
  const feeItems = extractFeeItems($);
  if (feeItems.length) {
    sections.push({ title: 'Chi phí lăn bánh', items: feeItems });
  }

  return {
    source: 'otoanhluong',
    sourceName: SOURCE_NAME,
    url,
    title,
    priceText,
    summary,
    sections,
    description: extractDescription($),
    gallery: extractGallery($),
    contact: extractContact($),
    scrapedAt: new Date().toISOString()
  };
}

module.exports = { fetchOtoAnhLuongCars, fetchOtoAnhLuongCarDetail };
