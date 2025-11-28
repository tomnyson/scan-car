const cheerio = require('cheerio');
const { inferBrand } = require('../utils/brand');

const BASE_URL = 'https://bonbanh.com/';
const SALON_LIST_URL = `${BASE_URL}salon-oto-xe-cu-dak-lak`;
const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Accept-Language': 'vi,en;q=0.9'
};
const SOURCE_NAME = 'Bonbanh (Đắk Lắk)';

const cleanText = (value = '') => value.replace(/\s+/g, ' ').trim();
const cleanMultiline = (value = '') =>
  value
    .replace(/\r?\n|\r/g, '\n')
    .split('\n')
    .map((line) => cleanText(line))
    .filter(Boolean)
    .join('\n');

const absoluteUrl = (value = '') => {
  if (!value) return '';
  try {
    return new URL(value, BASE_URL).href;
  } catch {
    return value;
  }
};

async function fetchHtml(url) {
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    throw new Error(`Bonbanh trả về mã lỗi ${response.status}`);
  }
  return response.text();
}

function parseSalonList(html) {
  const $ = cheerio.load(html);
  const salons = [];

  $('.salon_item a').each((index, element) => {
    const anchor = $(element);
    const href = anchor.attr('href');
    if (!href) return;
    const url = absoluteUrl(href);
    const name = cleanText(anchor.find('.sl_title').text()) || cleanText(anchor.attr('title'));
    const address = cleanText(anchor.find('.s_i2').text());
    const description = cleanText(anchor.find('.s_spec').text());
    const slug = (() => {
      try {
        return new URL(url).hostname.replace(/\./g, '-');
      } catch {
        return `salon-${index}`;
      }
    })();

    salons.push({
      id: `bonbanh-salon-${slug}`,
      name,
      address,
      description,
      url
    });
  });

  return salons;
}

function parseSalonCars(html, salon) {
  const $ = cheerio.load(html);
  const cars = [];
  $('#main_products li').each((index, element) => {
    const item = $(element);
    const title = cleanText(item.find('.item_title b').text());
    const link = item.find('.item_title a').attr('href');
    if (!title || !link) return;
    const url = absoluteUrl(link);
    const priceText = cleanText(item.find('.item_price b').text()).replace(/^Giá:\s*/i, '');
    const description = cleanText(item.find('.item_description').text());
    const thumb = item.find('.item_img img').attr('src');
    const thumbnail = absoluteUrl(thumb);
    const tooltip = cleanMultiline(item.find('.div_tip').text());
    const brandInfo = inferBrand([title, url, salon?.name]);
    const carIdMatch = url.match(/id,(\d+)/i);
    const carId = carIdMatch ? carIdMatch[1] : `${salon?.id || 'bonbanh'}-${index}`;

    const attributes = [];
    if (salon?.name) {
      attributes.push({ label: 'Salon', value: salon.name });
    }
    if (salon?.address) {
      attributes.push({ label: 'Địa chỉ', value: salon.address });
    }
    if (description) {
      attributes.push({ label: 'Tổng quan', value: description });
    }
    if (tooltip) {
      attributes.push({ label: 'Thông tin thêm', value: tooltip });
    }

    cars.push({
      id: `bonbanh-${carId}`,
      source: 'bonbanh',
      sourceName: salon?.name ? `${SOURCE_NAME} - ${salon.name}` : SOURCE_NAME,
      title,
      priceText,
      thumbnail,
      url,
      attributes,
      brand: brandInfo.brand,
      brandSlug: brandInfo.brandSlug
    });
  });

  return cars;
}

async function fetchBonbanhCars() {
  const html = await fetchHtml(SALON_LIST_URL);
  const salons = parseSalonList(html);
  if (!salons.length) {
    throw new Error('Không tìm thấy salon nào ở Đắk Lắk trên Bonbanh');
  }

  const allCars = [];
  const seen = new Set();

  for (const salon of salons) {
    try {
      const salonHtml = await fetchHtml(salon.url);
      const cars = parseSalonCars(salonHtml, salon);
      cars.forEach((car) => {
        if (!seen.has(car.id)) {
          seen.add(car.id);
          allCars.push(car);
        }
      });
    } catch (error) {
      console.warn(`Không thể lấy dữ liệu salon ${salon.name || salon.url}:`, error.message);
    }
  }

  return allCars;
}

const collectBoxItems = ($, box) => {
  const items = [];
  box.find('.tab_left_item, .tab_right_item').each((_, row) => {
    const spans = $(row).find('span');
    if (!spans.length) return;
    const label = cleanText(spans.first().text()).replace(/:$/, '');
    let value = cleanText(spans.last().text());
    if (!value) {
      const checkbox = spans.last().find('input[type="checkbox"]');
      if (checkbox.length) {
        value = checkbox.is('[checked]') ? 'Có' : '';
      }
    }
    if (label && value) {
      items.push({ label, value });
    }
  });
  return items;
};

function extractTabSections($, pane) {
  const sections = [];
  $(pane)
    .find('.tab_title')
    .each((_, titleNode) => {
      const title = cleanText($(titleNode).text());
      const box = $(titleNode).next('.tab_left_box, .tab_right_box, .tab_bottom_box');
      if (!box.length) return;
      if (box.hasClass('tab_bottom_box')) {
        const text = cleanMultiline(box.text());
        if (text) {
          sections.push({ title: title || 'Thông tin mô tả', items: [{ label: 'Chi tiết', value: text }] });
        }
        return;
      }
      const items = collectBoxItems($, box);
      if (items.length) {
        sections.push({ title: title || 'Thông tin', items });
      }
    });
  return sections;
}

function extractGallery($) {
  const images = new Set();
  $('#detail_list_img_left a, #detail_list_img_right img, #detail_list_img_right a').each((_, element) => {
    const node = $(element);
    const href = node.attr('href');
    const src = node.attr('src');
    const url = absoluteUrl(href || src);
    if (url) {
      images.add(url);
    }
  });
  return [...images];
}

async function fetchBonbanhCarDetail(detailUrl) {
  const url = absoluteUrl(detailUrl);
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const title = cleanText($('#detail_title p').text());
  const priceText = cleanText($('.price_list_car b').text());

  const tabSections = [];
  let summary = [];
  let description = '';

  $('#detail_tabber .tab-pane').each((index, pane) => {
    const paneSections = extractTabSections($, pane);
    if (!paneSections.length) {
      return;
    }
    paneSections.forEach((section) => {
      if (
        !description &&
        /mô tả|chi tiết/i.test(section.title || '') &&
        section.items?.[0]?.value
      ) {
        description = section.items[0].value;
      }
      tabSections.push(section);
    });
    if (index === 0) {
      paneSections.forEach((section) => {
        section.items.forEach((item) => {
          if (summary.length < 8) {
            summary.push(item);
          }
        });
      });
    }
  });

  const summaryFallback = cleanMultiline($('#item_description, .item_description').first().text());
  if (!summary.length && summaryFallback) {
    summary = [{ label: 'Mô tả', value: summaryFallback }];
  }

  if (!description) {
    description = summaryFallback || '';
  }

  const contact = {
    dealer: cleanText($('#item_head').text()),
    hotline: cleanText($('#item_phone span').text()),
    address: cleanText($('#item_address').text().replace(/^Địa chỉ:\s*/i, ''))
  };

  return {
    source: 'bonbanh',
    sourceName: SOURCE_NAME,
    url,
    title,
    priceText,
    summary,
    sections: tabSections,
    description,
    gallery: extractGallery($),
    contact,
    scrapedAt: new Date().toISOString()
  };
}

module.exports = { fetchBonbanhCars, fetchBonbanhCarDetail };
