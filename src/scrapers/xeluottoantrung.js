const cheerio = require('cheerio');
const { inferBrand } = require('../utils/brand');

const BASE_URL = 'https://xeluottoantrung.com/';
const LIST_URL = `${BASE_URL}san-pham`;
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Accept-Language': 'vi,en;q=0.9'
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

function parseCarsFromDom($) {
  const cars = [];
  $('.wap_item > .item').each((index, element) => {
    const node = $(element);
    const anchor = node.find('h3.name_sp a');
    const title = cleanText(anchor.text());
    if (!title) return;

    const slug = anchor.attr('href') || '';
    const link = absoluteUrl(slug);
    const brandInfo = inferBrand([slug, title]);

    const imgNode = node.find('.img_sp img').first();
    const image = imgNode.attr('data-lazy') || imgNode.attr('src') || '';
    const thumbnail = absoluteUrl(image);

    const priceText = cleanText(node.find('.gia_sp b').text());

    const attributes = [];
    node.find('.mota ul li').each((_, li) => {
      const field = $(li);
      const label = cleanText(field.find('img').attr('alt') || 'Thông tin');
      const value = cleanText(field.clone().children('img').remove().end().text());
      if (value) {
        attributes.push({ label, value });
      }
    });

    const id = node.find('p.id_ss').attr('data-id') || slug || String(index);

    cars.push({
      id: `xeluottoantrung-${id}`,
      source: 'xeluottoantrung',
      sourceName: 'Xe Lướt Toàn Trung',
      title,
      priceText,
      thumbnail,
      url: link,
      attributes,
      brand: brandInfo.brand,
      brandSlug: brandInfo.brandSlug
    });
  });
  return cars;
}

function parseTotalPages($) {
  let maxPage = 1;
  $('.pagination-home .page-link').each((_, element) => {
    const node = $(element);
    const textValue = cleanText(node.text());
    const number = Number(textValue);
    if (Number.isFinite(number)) {
      maxPage = Math.max(maxPage, number);
    }
    const href = node.attr('href') || '';
    const match = href.match(/[?&]p=(\d+)/i);
    if (match) {
      const pageFromHref = Number(match[1]);
      if (Number.isFinite(pageFromHref)) {
        maxPage = Math.max(maxPage, pageFromHref);
      }
    }
  });
  return maxPage;
}

async function fetchPage(page = 1) {
  const url = page > 1 ? `${LIST_URL}?p=${page}` : LIST_URL;
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    throw new Error(`Toàn Trung trả về mã lỗi ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const cars = parseCarsFromDom($);
  const totalPages = page === 1 ? parseTotalPages($) : undefined;
  return { cars, totalPages };
}

async function fetchXeLuotToanTrungCars() {
  const results = [];
  const seen = new Set();

  const firstPage = await fetchPage(1);
  let totalPages = firstPage.totalPages || 1;

  firstPage.cars.forEach((car) => {
    if (!seen.has(car.id)) {
      results.push(car);
      seen.add(car.id);
    }
  });

  for (let page = 2; page <= totalPages; page++) {
    const { cars } = await fetchPage(page);
    if (!cars.length) {
      break;
    }
    cars.forEach((car) => {
      if (!seen.has(car.id)) {
        results.push(car);
        seen.add(car.id);
      }
    });
  }

  return results;
}

module.exports = { fetchXeLuotToanTrungCars };
