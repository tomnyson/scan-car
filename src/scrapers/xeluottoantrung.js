const cheerio = require('cheerio');
const { inferBrand } = require('../utils/brand');

const BASE_URL = 'https://xeluottoantrung.com/';
const LIST_URL = `${BASE_URL}san-pham`;
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Accept-Language': 'vi,en;q=0.9'
};
const SOURCE_NAME = 'Xe Lướt Toàn Trung';

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
      sourceName: SOURCE_NAME,
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

function extractSummary($) {
  const summary = [];
  $('.right-pro-detail .mota ul li').each((_, li) => {
    const node = $(li);
    const label = cleanText(node.find('img').attr('alt') || 'Thông tin');
    const clone = node.clone();
    clone.find('img').remove();
    const value = cleanText(clone.text());
    if (value) {
      summary.push({ label, value });
    }
  });
  return summary;
}

function extractLabelValueList($, list) {
  const items = [];
  list.find('li').each((_, li) => {
    const node = $(li);
    const value = cleanText(node.find('b').text());
    const clone = node.clone();
    clone.find('b').remove();
    clone.find('img').remove();
    const label = cleanText(clone.text());
    const fallbackValue = cleanText(
      node
        .clone()
        .children('img')
        .remove()
        .end()
        .text()
    );
    const finalValue = value || fallbackValue;
    if (!label && !finalValue) return;
    items.push({ label: label || 'Thông tin', value: finalValue || label });
  });
  return items;
}

function extractPrimarySections($) {
  const sections = [];
  $('.tongquan').each((_, element) => {
    const section = $(element);
    const title = cleanText(section.find('.title-main span').first().text());
    const listItems = extractLabelValueList($, section.find('ul'));
    if (listItems.length) {
      sections.push({ title: title || 'Thông tin', items: listItems });
    }
  });
  return sections;
}

function extractSpecSections($) {
  const container = $('#tskt');
  if (!container.length) return [];
  const sections = [];
  let current = null;

  container.children().each((_, child) => {
    const node = $(child);
    if (node.is('p.td_ts')) {
      if (current && current.items.length) {
        sections.push(current);
      }
      current = { title: cleanText(node.text()), items: [] };
      return;
    }
    if (node.is('ul') && current) {
      const items = extractLabelValueList($, node);
      if (items.length) {
        current.items.push(...items);
      }
    }
  });

  if (current && current.items.length) {
    sections.push(current);
  }
  return sections;
}

function extractGallery($) {
  const images = [];
  const seen = new Set();
  $('.album_pro a.MagicZoom').each((_, anchor) => {
    const href = absoluteUrl($(anchor).attr('href'));
    if (href && !seen.has(href)) {
      seen.add(href);
      images.push(href);
    }
  });
  if (!images.length) {
    $('.album_pro2 img').each((_, img) => {
      const src = absoluteUrl($(img).attr('src'));
      if (src && !seen.has(src)) {
        seen.add(src);
        images.push(src);
      }
    });
  }
  return images;
}

async function fetchXeLuotToanTrungCarDetail(detailUrl) {
  const url = absoluteUrl(detailUrl);
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    throw new Error(`Toàn Trung trả về mã lỗi ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const title =
    cleanText($('.right-pro-detail .name_sp a').first().text()) ||
    cleanText($('h1.hidden-seoh').first().text());
  const priceText = cleanText($('.right-pro-detail .gia_sp b').first().text());
  const summary = extractSummary($);
  const sections = [...extractPrimarySections($), ...extractSpecSections($)].filter(
    (section) => section.title && section.items && section.items.length
  );

  const hotlineNode = $('.lienhe_ct a[href^="tel:"]').first();
  const hotlineLink = hotlineNode.attr('href') || '';
  const hotline =
    cleanText(hotlineNode.find('span').text()) || cleanText(hotlineNode.text().replace(/Hotline/i, ''));
  const contact = {
    hotline,
    hotlineLink,
    zaloUrl: absoluteUrl($('.lienhe_ct a[href*="zalo.me"]').attr('href') || ''),
    branchUrl: $('.dangky_ct a.c_laithu').attr('href') || '',
    branchLabel: cleanText($('.dangky_ct a.c_laithu').text())
  };

  return {
    source: 'xeluottoantrung',
    sourceName: SOURCE_NAME,
    url,
    title,
    priceText,
    summary,
    sections,
    description: '',
    gallery: extractGallery($),
    contact,
    scrapedAt: new Date().toISOString()
  };
}

module.exports = { fetchXeLuotToanTrungCars, fetchXeLuotToanTrungCarDetail };
