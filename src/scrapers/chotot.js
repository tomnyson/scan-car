const { inferBrand } = require('../utils/brand');

const API_BASE_URL = 'https://gateway.chotot.com/v1/public/ad-listing';
const DETAIL_API_URL = 'https://gateway.chotot.com/v1/public/ad-listing';
const BASE_URL = 'https://xe.chotot.com';
const SOURCE_NAME = 'Chợ Tốt (Buôn Ma Thuột)';
const SOURCE_ID = 'chotot';

// BMT location coordinates
const DEFAULT_LATITUDE = 12.6796827;
const DEFAULT_LONGITUDE = 108.0447368;
const DEFAULT_DISTANCE = 10; // 10km radius

const REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'vi,en;q=0.9'
};

const cleanText = (value = '') => value.replace(/\s+/g, ' ').trim();

const formatPrice = (price) => {
    if (!price || price <= 0) return 'Thỏa thuận';
    if (price >= 1000000000) {
        const billions = price / 1000000000;
        return `${billions.toFixed(billions % 1 === 0 ? 0 : 1)} tỷ`;
    }
    if (price >= 1000000) {
        const millions = price / 1000000;
        return `${millions.toFixed(millions % 1 === 0 ? 0 : 0)} triệu`;
    }
    return new Intl.NumberFormat('vi-VN').format(price) + ' đ';
};

// Check if listing is a valid car (ô tô)
const isValidCar = (ad) => {
    // Must have category 2010 (ô tô) or be in car subcategories
    const carCategories = [2010, 2020, 2030]; // ô tô mới, ô tô cũ, etc.
    if (ad.category && !carCategories.includes(ad.category)) {
        // Check if it's a car by other indicators
        if (!ad.car_year && !ad.number_of_seat && !ad.gearbox) {
            return false;
        }
    }

    // Filter out motorcycles and other vehicles by keywords
    const title = (ad.subject || ad.title || '').toLowerCase();
    const excludeKeywords = [
        'xe máy', 'xe may', 'mô tô', 'mo to', 'môtô', 'moto',
        'xe đạp', 'xe dap', 'scooter', 'exciter', 'winner', 'wave',
        'sirius', 'jupiter', 'vision', 'air blade', 'airblade', 'sh ',
        'lead', 'vario', 'pcx', 'nvx', 'grande', 'janus', 'freego',
        'vespa', 'piaggio', 'r15', 'mt-15', 'mt15', 'cbr150', 'cb150',
        'raider', 'satria', 'sonic', 'future', 'dream', 'cub',
        'xe tải', 'xe tai', 'xe ben', 'xe bồn', 'xe bon', 'xe cẩu', 'xe cau',
        'xe nâng', 'xe nang', 'xe đầu kéo', 'xe dau keo', 'máy nông nghiệp'
    ];

    for (const keyword of excludeKeywords) {
        if (title.includes(keyword)) {
            return false;
        }
    }

    // Must have price >= 50 million VND (cars are expensive)
    const price = ad.price || 0;
    if (price > 0 && price < 50000000) {
        return false; // Too cheap to be a car
    }

    return true;
};

const buildListUrl = (options = {}) => {
    const params = new URLSearchParams({
        cg: '2010',  // Category: ô tô (cars only, not 2000 which includes motorcycles)
        latitude: options.latitude || DEFAULT_LATITUDE,
        longitude: options.longitude || DEFAULT_LONGITUDE,
        distance: options.distance || DEFAULT_DISTANCE,
        limit: options.limit || 100, // Fetch more to compensate for filtering
        o: options.offset || 0,
        st: 's,k',  // status: selling
        f: 'p',     // filter
        key_param_included: 'true'
    });

    return `${API_BASE_URL}?${params.toString()}`;
};

const buildDetailUrl = (listingId) => {
    return `https://gateway.chotot.com/v1/public/ad-listing/${listingId}`;
};

const getCarUrl = (listingId, subject = '') => {
    const slug = subject
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    return `${BASE_URL}/${slug}-i${listingId}`;
};

async function fetchApi(url) {
    const response = await fetch(url, { headers: REQUEST_HEADERS });
    if (!response.ok) {
        throw new Error(`Chợ Tốt API trả về mã lỗi ${response.status}`);
    }
    return response.json();
}

function parseCarFromListing(ad) {
    const listingId = ad.list_id || ad.ad_id;
    const subject = ad.subject || ad.title || '';
    const price = ad.price || 0;
    const priceText = formatPrice(price);

    // Get thumbnail
    const thumbnail = ad.image || ad.thumbnail || '';

    // Extract attributes
    const attributes = [];

    // Year
    if (ad.car_year) {
        attributes.push({ label: 'Năm sản xuất', value: String(ad.car_year) });
    }

    // Mileage/KM
    if (ad.mileage_v2 || ad.mileage) {
        const km = ad.mileage_v2 || ad.mileage;
        attributes.push({ label: 'Số km đã đi', value: `${new Intl.NumberFormat('vi-VN').format(km)} km` });
    }

    // Transmission
    if (ad.gearbox) {
        const gearboxText = ad.gearbox === 1 ? 'Số sàn' : ad.gearbox === 2 ? 'Số tự động' : String(ad.gearbox);
        attributes.push({ label: 'Hộp số', value: gearboxText });
    }

    // Fuel type
    if (ad.fuel) {
        const fuelMap = { 1: 'Xăng', 2: 'Dầu', 3: 'Hybrid', 4: 'Điện' };
        attributes.push({ label: 'Nhiên liệu', value: fuelMap[ad.fuel] || String(ad.fuel) });
    }

    // Number of seats
    if (ad.number_of_seat) {
        attributes.push({ label: 'Số chỗ ngồi', value: `${ad.number_of_seat} chỗ` });
    }

    // Origin
    if (ad.origin) {
        const originMap = { 1: 'Trong nước', 2: 'Nhập khẩu' };
        attributes.push({ label: 'Xuất xứ', value: originMap[ad.origin] || String(ad.origin) });
    }

    // Body type
    if (ad.body_type) {
        attributes.push({ label: 'Kiểu dáng', value: ad.body_type_name || String(ad.body_type) });
    }

    // Location/Area
    if (ad.area_name || ad.region_name) {
        const location = [ad.area_name, ad.region_name].filter(Boolean).join(', ');
        attributes.push({ label: 'Khu vực', value: location });
    }

    // Brand inference
    const brandInfo = inferBrand([subject, ad.brand_name, ad.model_name]);

    // Build car URL
    const url = getCarUrl(listingId, subject);

    return {
        id: `${SOURCE_ID}-${listingId}`,
        source: SOURCE_ID,
        sourceName: SOURCE_NAME,
        title: cleanText(subject),
        priceText,
        thumbnail,
        url,
        attributes,
        brand: brandInfo.brand || ad.brand_name || '',
        brandSlug: brandInfo.brandSlug || '',
        seatCount: ad.number_of_seat || null,
        yearValue: ad.car_year || null,
        listingId
    };
}

async function fetchChototCars(options = {}) {
    const url = buildListUrl(options);
    const data = await fetchApi(url);

    if (!data.ads || !Array.isArray(data.ads)) {
        console.warn('Chợ Tốt: Không tìm thấy dữ liệu xe');
        return [];
    }

    const cars = data.ads
        .filter(ad => ad && (ad.list_id || ad.ad_id) && isValidCar(ad))
        .map(ad => {
            try {
                return parseCarFromListing(ad);
            } catch (error) {
                console.warn('Chợ Tốt: Lỗi parse xe:', error.message);
                return null;
            }
        })
        .filter(Boolean);

    return cars;
}

async function fetchChototCarDetail(urlOrId) {
    // Extract listing ID from URL or use directly
    let listingId = urlOrId;
    if (typeof urlOrId === 'string' && urlOrId.includes('chotot.com')) {
        const match = urlOrId.match(/-i(\d+)(?:\.htm)?$/);
        if (match) {
            listingId = match[1];
        }
    }

    const apiUrl = buildDetailUrl(listingId);
    const data = await fetchApi(apiUrl);

    const ad = data.ad || data;
    if (!ad) {
        throw new Error('Không tìm thấy thông tin xe');
    }

    const subject = ad.subject || ad.title || '';
    const price = ad.price || 0;
    const priceText = formatPrice(price);

    // Build summary
    const summary = [];

    if (ad.car_year) {
        summary.push({ label: 'Năm sản xuất', value: String(ad.car_year) });
    }
    if (ad.brand_name) {
        summary.push({ label: 'Hãng xe', value: ad.brand_name });
    }
    if (ad.model_name) {
        summary.push({ label: 'Dòng xe', value: ad.model_name });
    }
    if (ad.mileage_v2 || ad.mileage) {
        const km = ad.mileage_v2 || ad.mileage;
        summary.push({ label: 'Số km đã đi', value: `${new Intl.NumberFormat('vi-VN').format(km)} km` });
    }
    if (ad.gearbox) {
        const gearboxText = ad.gearbox === 1 ? 'Số sàn' : ad.gearbox === 2 ? 'Số tự động' : String(ad.gearbox);
        summary.push({ label: 'Hộp số', value: gearboxText });
    }
    if (ad.fuel) {
        const fuelMap = { 1: 'Xăng', 2: 'Dầu', 3: 'Hybrid', 4: 'Điện' };
        summary.push({ label: 'Nhiên liệu', value: fuelMap[ad.fuel] || String(ad.fuel) });
    }
    if (ad.number_of_seat) {
        summary.push({ label: 'Số chỗ ngồi', value: `${ad.number_of_seat} chỗ` });
    }
    if (ad.origin) {
        const originMap = { 1: 'Trong nước', 2: 'Nhập khẩu' };
        summary.push({ label: 'Xuất xứ', value: originMap[ad.origin] || String(ad.origin) });
    }

    // Build sections
    const sections = [];

    // Vehicle info section
    const vehicleInfo = [];
    if (ad.brand_name) vehicleInfo.push({ label: 'Hãng xe', value: ad.brand_name });
    if (ad.model_name) vehicleInfo.push({ label: 'Dòng xe', value: ad.model_name });
    if (ad.car_year) vehicleInfo.push({ label: 'Năm sản xuất', value: String(ad.car_year) });
    if (ad.body_type_name) vehicleInfo.push({ label: 'Kiểu dáng', value: ad.body_type_name });
    if (ad.exterior_color) vehicleInfo.push({ label: 'Màu ngoại thất', value: ad.exterior_color });
    if (vehicleInfo.length) {
        sections.push({ title: 'Thông tin xe', items: vehicleInfo });
    }

    // Technical specs section
    const techSpecs = [];
    if (ad.engine) techSpecs.push({ label: 'Dung tích động cơ', value: ad.engine });
    if (ad.mileage_v2 || ad.mileage) {
        const km = ad.mileage_v2 || ad.mileage;
        techSpecs.push({ label: 'Số km đã đi', value: `${new Intl.NumberFormat('vi-VN').format(km)} km` });
    }
    if (ad.gearbox) {
        const gearboxText = ad.gearbox === 1 ? 'Số sàn' : ad.gearbox === 2 ? 'Số tự động' : String(ad.gearbox);
        techSpecs.push({ label: 'Hộp số', value: gearboxText });
    }
    if (ad.fuel) {
        const fuelMap = { 1: 'Xăng', 2: 'Dầu', 3: 'Hybrid', 4: 'Điện' };
        techSpecs.push({ label: 'Nhiên liệu', value: fuelMap[ad.fuel] || String(ad.fuel) });
    }
    if (ad.number_of_seat) {
        techSpecs.push({ label: 'Số chỗ ngồi', value: `${ad.number_of_seat} chỗ` });
    }
    if (ad.drivetrain) {
        const driveMap = { 1: 'Cầu trước (FWD)', 2: 'Cầu sau (RWD)', 3: '4 cầu (4WD/AWD)' };
        techSpecs.push({ label: 'Dẫn động', value: driveMap[ad.drivetrain] || String(ad.drivetrain) });
    }
    if (techSpecs.length) {
        sections.push({ title: 'Thông số kỹ thuật', items: techSpecs });
    }

    // Gallery images
    const gallery = [];
    if (ad.images && Array.isArray(ad.images)) {
        ad.images.forEach(img => {
            if (typeof img === 'string') {
                gallery.push(img);
            } else if (img.url) {
                gallery.push(img.url);
            }
        });
    } else if (ad.image) {
        gallery.push(ad.image);
    }

    // Contact info
    const contact = {
        dealer: ad.account_name || '',
        phone: ad.phone || ad.phone_hidden || '',
        hotline: ad.phone || '',
        hotlineLink: ad.phone ? `tel:${ad.phone.replace(/\s+/g, '')}` : ''
    };

    // Location
    if (ad.area_name || ad.region_name) {
        contact.address = [ad.area_name, ad.region_name].filter(Boolean).join(', ');
    }

    const carUrl = getCarUrl(ad.list_id || ad.ad_id, subject);

    return {
        source: SOURCE_ID,
        sourceName: SOURCE_NAME,
        url: carUrl,
        title: cleanText(subject),
        priceText,
        summary,
        sections,
        description: ad.body || ad.description || '',
        gallery,
        contact,
        scrapedAt: new Date().toISOString()
    };
}

module.exports = { fetchChototCars, fetchChototCarDetail };
