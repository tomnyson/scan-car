const cheerio = require('cheerio');
const { inferBrand } = require('../utils/brand');

const BASE_URL = 'https://vnexpress.net';
const PAGE_URL = `${BASE_URL}/oto-xe-may/v-car`;
const LIST_API = `${BASE_URL}/oto-xe-may/v-car/banggiaxe/-1`;
const SOURCE_ID = 'vcar';
const SOURCE_NAME = 'VnExpress V-Car';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
const AJAX_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest'
};
const PAGE_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'vi,en;q=0.9'
};

const cleanText = (value = '') => value.replace(/\s+/g, ' ').trim();
const slugify = (value = '') =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const absoluteUrl = (value = '') => {
  if (!value) return '';
  try {
    return new URL(value, BASE_URL).href;
  } catch (error) {
    return value;
  }
};

async function fetchHtml(url, headers = PAGE_HEADERS) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`V-Car trả về mã lỗi ${response.status}`);
  }
  return response.text();
}

async function fetchAjaxTableHtml() {
  const response = await fetch(LIST_API, { headers: AJAX_HEADERS });
  if (!response.ok) {
    throw new Error(`V-Car trả về mã lỗi ${response.status}`);
  }

  const data = await response.json();
  if (data.error && Number(data.error) !== 0) {
    throw new Error(`V-Car trả về lỗi: ${data.error}`);
  }

  return data.html || '';
}

function extractTableRowsFromPage(html) {
  const $ = cheerio.load(html);
  const rows = $('.table-car-content .banggiaxe-item');
  if (!rows.length) return '';

  return rows
    .map((_, element) => $.html(element))
    .get()
    .join('\n');
}

function parseTableRows(html) {
  // The API returns raw <tr> fragments; wrap in a table so cheerio can parse them reliably.
  const $ = cheerio.load(`<table>${html}</table>`);
  const cars = [];

  $('.banggiaxe-item').each((index, element) => {
    const row = $(element);
    const brandAnchor = row.find('.td-name a').first();
    const modelAnchor = row.find('td').eq(1).find('a').first();

    const brandName = cleanText(brandAnchor.text());
    const modelName = cleanText(modelAnchor.text()) || cleanText(row.find('td').eq(1).text());
    const version = cleanText(row.find('td').eq(2).text());
    const segment = cleanText(row.find('td').eq(3).text());
    const engine = cleanText(row.find('td').eq(4).text());
    const priceText = cleanText(row.find('td').eq(5).text());
    const negotiate = cleanText(row.find('td').eq(6).text());
    const lifeId = cleanText(row.attr('data-life-id')) || `${brandName}-${modelName}-${version}` || String(index);
    const variantKey = version ? slugify(version) : String(index);

    const brandInfo = inferBrand([brandName, modelName]);
    const brand = brandInfo.brand || brandName;
    const brandSlug = brandInfo.brandSlug || slugify(brandName || brandInfo.brand || modelName);

    const titleParts = [brand, modelName, version].filter(Boolean);
    const title = titleParts.join(' ').trim() || modelName || brand || 'V-Car';

    const attributes = [];
    if (version) attributes.push({ label: 'Phiên bản', value: version });
    if (segment) attributes.push({ label: 'Phân khúc', value: segment });
    if (engine) attributes.push({ label: 'Động cơ', value: engine });
    if (negotiate) attributes.push({ label: 'Đàm phán', value: negotiate });

    const url = absoluteUrl(modelAnchor.attr('href') || brandAnchor.attr('href') || '/oto-xe-may/v-car');

    const id = `${SOURCE_ID}-${lifeId}-${variantKey}-${index}`;

    cars.push({
      id,
      source: SOURCE_ID,
      sourceName: SOURCE_NAME,
      title,
      model: modelName,
      version,
      segment,
      engine,
      negotiate,
      priceText: priceText || 'Giá niêm yết: --',
      thumbnail: '',
      url,
      attributes,
      brand,
      brandSlug
    });
  });

  return cars;
}

async function fetchVCarPrices() {
  let html = '';

  // Try to read the already-rendered table from the main page.
  try {
    const pageHtml = await fetchHtml(PAGE_URL);
    html = extractTableRowsFromPage(pageHtml);
  } catch (error) {
    console.warn('Không thể lấy bảng giá từ trang chính V-Car:', error.message);
  }

  // Fallback to the AJAX endpoint if the page doesn't include the rows (common case).
  if (!html) {
    html = await fetchAjaxTableHtml();
  }

  if (!html) return [];
  return parseTableRows(html);
}

module.exports = { fetchVCarPrices };
