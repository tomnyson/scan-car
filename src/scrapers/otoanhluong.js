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

const ICON_LABEL_MAP = {
  'fa-calendar-alt': 'Năm sản xuất',
  'fa-tachometer-alt': 'ODO',
  'fa-gas-pump': 'Nhiên liệu',
  'fa-car': 'Kiểu dáng'
};

const cleanText = (value = '') => value.replace(/\s+/g, ' ').trim();
const absoluteUrl = (value = '') => {
  if (!value) return '';
  try {
    return new URL(value, BASE_URL).href;
  } catch (error) {
    return value;
  }
};

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
    sourceName: 'Anh Lượng Auto',
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

module.exports = { fetchOtoAnhLuongCars };
