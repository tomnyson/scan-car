const RAW_BRANDS = [
  { name: 'Audi', keywords: ['audi'] },
  { name: 'BMW', keywords: ['bmw'] },
  { name: 'Chevrolet', keywords: ['chevrolet', 'chevy'] },
  { name: 'Dongfeng', keywords: ['dongfeng'] },
  { name: 'Ford', keywords: ['ford'] },
  { name: 'Hino', keywords: ['hino'] },
  { name: 'Honda', keywords: ['honda'] },
  { name: 'Hyundai', keywords: ['hyundai', 'huynhdai', 'huyndai'] },
  { name: 'Isuzu', keywords: ['isuzu'] },
  { name: 'Kia', keywords: ['kia'] },
  { name: 'Land Rover', keywords: ['land rover', 'landrover'] },
  { name: 'Lexus', keywords: ['lexus'] },
  { name: 'Mazda', keywords: ['mazda'] },
  { name: 'Mercedes-Benz', keywords: ['mercedes benz', 'mercedes-benz', 'mercedes'] },
  { name: 'Mitsubishi', keywords: ['mitsubishi'] },
  { name: 'Nissan', keywords: ['nissan'] },
  { name: 'Peugeot', keywords: ['peugeot'] },
  { name: 'Porsche', keywords: ['porsche'] },
  { name: 'Subaru', keywords: ['subaru'] },
  { name: 'Suzuki', keywords: ['suzuki'] },
  { name: 'Toyota', keywords: ['toyota'] },
  { name: 'VinFast', keywords: ['vinfast'] },
  { name: 'Volkswagen', keywords: ['volkswagen', 'vw'] },
  { name: 'Volvo', keywords: ['volvo'] }
];

const normalize = (value = '') =>
  value
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const brandSlug = (name = '') => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const BRAND_KEYWORDS = RAW_BRANDS.flatMap(({ name, keywords }) =>
  keywords.map((keyword) => [normalize(keyword), name])
);

function detectBrand(value = '') {
  const normalized = normalize(value);
  if (!normalized) return '';
  const padded = ` ${normalized} `;
  for (const [keyword, name] of BRAND_KEYWORDS) {
    if (padded.includes(` ${keyword} `)) {
      return name;
    }
  }
  return '';
}

function inferBrand(candidates = []) {
  for (const candidate of candidates) {
    const name = detectBrand(candidate);
    if (name) {
      return { brand: name, brandSlug: brandSlug(name) };
    }
  }
  return { brand: '', brandSlug: '' };
}

module.exports = {
  inferBrand
};
