const cheerio = require('cheerio');
const { inferBrand } = require('../utils/brand');

const BASE_URL = 'https://bonbanh.com/';
const DEFAULT_LIST_URL = process.env.BONBANH_LIST_URL || `${BASE_URL}oto`;
const DEFAULT_MAX_PAGES = Number(process.env.BONBANH_MAX_PAGES) || 5;
const DEFAULT_PAGE_DELAY_MS = Number(process.env.BONBANH_PAGE_DELAY_MS) || 500;
const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Accept-Language': 'vi,en;q=0.9'
};
const SOURCE_NAME = 'Bonbanh';
const SALON_LIST_URL = `${BASE_URL}salon-oto-xe-cu-dak-lak`;

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseListingPage(html) {
  const $ = cheerio.load(html);
  const cars = [];

  $('li.car-item').each((_, element) => {
    const item = $(element);
    const anchor = item.find('a[itemprop="url"]').first();
    const href = anchor.attr('href');
    if (!href) return;

    const url = absoluteUrl(href);
    const title = cleanText(item.find('h3[itemprop="name"]').text()) || cleanText(anchor.attr('title'));
    if (!title) return;

    const priceEl = item.find('b[itemprop="price"]').first();
    const priceRaw = priceEl.attr('content');
    const priceText = cleanText(priceEl.clone().find('meta').remove().end().text());

    const year = cleanText(item.find('.cb1 b').text());
    const location = cleanText(item.find('.cb4 b').text());
    const thumbnail = absoluteUrl(item.find('.cb5 img').attr('src'));
    const dealer = cleanText(item.find('.cb7 b').text());
    const dealerAddress = cleanText(
      item.find('.cb7 span').first().text()
    );
    const description = cleanText(item.find('.cb6_02').text());

    const codeMatch = item.find('.car_code').text().match(/\d+/);
    const idMatch = href.match(/-(\d+)(?:$|[?#])/);
    const carId = codeMatch?.[0] || idMatch?.[1];
    if (!carId) return;

    const brandInfo = inferBrand([title, url]);

    const attributes = [];
    if (year) attributes.push({ label: 'Năm sản xuất', value: year });
    if (location) attributes.push({ label: 'Vị trí', value: location });
    if (dealer) attributes.push({ label: 'Người bán', value: dealer });
    if (dealerAddress) attributes.push({ label: 'Địa chỉ', value: dealerAddress });
    if (description) attributes.push({ label: 'Mô tả', value: description });

    cars.push({
      id: `bonbanh-${carId}`,
      source: 'bonbanh',
      sourceName: SOURCE_NAME,
      title,
      priceText,
      priceValue: priceRaw ? Number(priceRaw) : null,
      yearValue: year ? Number(year) : null,
      location,
      thumbnail,
      url,
      attributes,
      brand: brandInfo.brand,
      brandSlug: brandInfo.brandSlug
    });
  });

  return cars;
}

function nextPageUrl(html, currentPage) {
  const $ = cheerio.load(html);
  const explicit = $('link[rel="next"]').attr('href');
  if (explicit) return absoluteUrl(explicit);
  // Fallback: derive from base URL of current listing (no rel=next on last page).
  return null;
}

async function fetchBonbanhCars(options = {}) {
  const listUrl = options.listUrl || DEFAULT_LIST_URL;
  const maxPages = Number(options.maxPages) || DEFAULT_MAX_PAGES;
  const pageDelayMs = Number(options.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS);
  // Chế độ incremental: dừng khi gặp chuỗi tin liên tiếp đã có trong existingIds.
  const existingIds = options.existingIds instanceof Set ? options.existingIds : null;
  const earlyStopStreak = Number(options.earlyStopStreak) || 40;

  const allCars = [];
  const seen = new Set();
  let currentUrl = listUrl;
  let consecutiveOld = 0;
  let pagesRead = 0;
  let stopReason = 'reached-max-pages';

  for (let page = 1; page <= maxPages && currentUrl; page += 1) {
    let html;
    try {
      html = await fetchHtml(currentUrl);
    } catch (error) {
      console.warn(`[Bonbanh] Trang ${page} lỗi (${currentUrl}):`, error.message);
      stopReason = 'fetch-error';
      break;
    }
    pagesRead = page;

    const cars = parseListingPage(html);
    if (!cars.length) {
      stopReason = 'empty-page';
      break;
    }

    let added = 0;
    let oldOnPage = 0;
    for (const car of cars) {
      if (seen.has(car.id)) continue;
      seen.add(car.id);
      allCars.push(car);
      added += 1;

      if (existingIds && existingIds.has(car.id)) {
        consecutiveOld += 1;
        oldOnPage += 1;
      } else if (existingIds) {
        consecutiveOld = 0;
      }
    }

    console.log(
      `[Bonbanh] Page ${page}: +${added} mới (${oldOnPage} đã có, streak=${consecutiveOld})`
    );

    if (existingIds && consecutiveOld >= earlyStopStreak) {
      stopReason = 'incremental-early-stop';
      break;
    }

    const next = nextPageUrl(html);
    if (!next) {
      stopReason = 'no-next-page';
      break;
    }
    currentUrl = next;

    if (pageDelayMs > 0) {
      await sleep(pageDelayMs + Math.floor(Math.random() * pageDelayMs));
    }
  }

  allCars.meta = { pagesRead, stopReason, total: allCars.length };
  return allCars;
}

// Legacy: giữ crawl theo salon Đắk Lắk cho các use case cũ.
async function fetchBonbanhSalonCars() {
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
  // Full-size images: <a class="highslide" href="...l_xxx.jpg"> quanh <img id="imgN">
  $('#medium_img a.highslide, #medium_img a[id^="lnk"]').each((_, element) => {
    const href = $(element).attr('href');
    const url = absoluteUrl(href);
    if (url) images.add(url);
  });
  if (images.size === 0) {
    $('#medium_img img[id^="img"]').each((_, element) => {
      const src = $(element).attr('src');
      const url = absoluteUrl(src);
      if (url) images.add(url);
    });
  }
  return [...images];
}

function extractSpecs($) {
  const items = [];
  $('.row, .row_last').each((_, row) => {
    const $row = $(row);
    const label = cleanText($row.find('.label label').text()).replace(/:$/, '');
    const value = cleanText($row.find('.txt_input .inp').text());
    if (label && value) {
      items.push({ label, value });
    }
  });
  return items;
}

function extractContact($) {
  const contactBox = $('.contact-box .cinfo');
  const dealer = cleanText(contactBox.find('.cname').first().text());
  const hotline = cleanText(contactBox.find('.cphone').first().text());
  // Address là text node giữa "Địa chỉ:" và "Website:"
  const contactText = cleanMultiline(contactBox.find('.contact-txt').text());
  const addressMatch = contactText.match(/Địa chỉ:\s*(.+?)(?:\s*Website:|$)/i);
  return {
    dealer,
    hotline,
    address: addressMatch ? cleanText(addressMatch[1]) : ''
  };
}

async function fetchBonbanhCarDetail(detailUrl) {
  const url = absoluteUrl(detailUrl);
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const rawTitle = cleanText($('.title h1').first().text());
  // Tách "Xe VinFast VF7 Eco 2026 - 725 Triệu" → title + price
  const titleMatch = rawTitle.match(/^(?:Xe\s+)?(.+?)\s*-\s*([\d.,]+\s*(?:Triệu|Tỷ)[^\-]*)$/i);
  const title = titleMatch ? cleanText(titleMatch[1]) : rawTitle;
  const priceText = titleMatch ? cleanText(titleMatch[2]) : '';

  const specs = extractSpecs($);
  const summary = specs.slice(0, 8);
  const description = cleanMultiline($('.des_txt').text());
  const contact = extractContact($);

  const sections = specs.length
    ? [{ title: 'Thông số kỹ thuật', items: specs }]
    : [];
  if (description) {
    sections.push({
      title: 'Mô tả',
      items: [{ label: 'Chi tiết', value: description }]
    });
  }

  return {
    source: 'bonbanh',
    sourceName: SOURCE_NAME,
    url,
    title,
    priceText,
    summary,
    sections,
    description,
    gallery: extractGallery($),
    contact,
    scrapedAt: new Date().toISOString()
  };
}

module.exports = { fetchBonbanhCars, fetchBonbanhCarDetail, fetchBonbanhSalonCars };
