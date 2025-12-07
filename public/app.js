const state = {
  data: [],
  sources: [],
  filters: {
    keyword: '',
    selectedSources: new Set(),
    selectedBrands: new Set(),
    priceMin: null,
    priceMax: null
  },
  sortBy: 'newest',
  viewMode: 'grid',
  updatedAt: null,
  isLoading: false,
  errors: [],
  brandOptions: [],
  brandDropdownOpen: false,
  autoReloadTimerId: null,
  detail: {
    isOpen: false,
    isLoading: false,
    carId: null,
    data: null,
    error: ''
  }
};

const els = {
  carGrid: document.getElementById('car-grid'),
  carCount: document.getElementById('car-count'),
  sourceFilters: document.getElementById('source-filters'),
  searchInput: document.getElementById('search-input'),
  statusMessage: document.getElementById('status-message'),
  updatedAt: document.getElementById('updated-at'),
  refreshBtn: document.getElementById('refresh-btn'),
  priceMin: document.getElementById('price-min'),
  priceMax: document.getElementById('price-max'),
  sortSelect: document.getElementById('sort-select'),
  viewGrid: document.getElementById('view-grid'),
  viewList: document.getElementById('view-list'),
  brandSelectInput: document.getElementById('brand-select-input'),
  brandSearchInput: document.getElementById('brand-search-input'),
  brandDropdown: document.getElementById('brand-dropdown'),
  brandOptions: document.getElementById('brand-options'),
  brandSelectedTags: document.getElementById('brand-selected-tags'),
  detailModal: document.getElementById('detail-modal'),
  detailModalContent: document.getElementById('detail-modal-content'),
  detailModalClose: document.getElementById('detail-modal-close'),
  detailModalOverlay: document.querySelector('[data-detail-close]'),
  loading: document.getElementById('loading')
};

const placeholderImage = 'https://placehold.co/600x400?text=No+Image';
const CACHE_KEY = 'scanCar:data';
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const AUTO_RELOAD_INTERVAL_MS = CACHE_TTL_MS;
const detailCache = new Map();

const dataCache = {
  save(payload) {
    if (typeof localStorage === 'undefined') return;
    try {
      let cachedAt = Date.now();
      if (payload?.updatedAt) {
        const serverTime = new Date(payload.updatedAt).getTime();
        if (!isNaN(serverTime)) {
          cachedAt = serverTime;
        }
      }

      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          payload,
          cachedAt
        })
      );
    } catch (error) {
      console.warn('Không thể lưu cache', error);
    }
  },
  load() {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const record = JSON.parse(raw);
      if (!record?.payload || !record.cachedAt) {
        return null;
      }
      if (Date.now() - record.cachedAt > CACHE_TTL_MS) {
        localStorage.removeItem(CACHE_KEY);
        return null;
      }
      return record.payload;
    } catch (error) {
      console.warn('Không thể đọc cache', error);
      return null;
    }
  }
};

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeAttr = (value = '') => escapeHtml(value);
const formatMultiline = (value = '') => escapeHtml(value).replace(/\n/g, '<br />');

const formatDate = (value) => {
  if (!value) return '---';
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch (error) {
    return value;
  }
};

// Extract price in millions from price text
const extractPrice = (priceText) => {
  if (!priceText) return null;

  // Match patterns like "500 triệu", "1.5 tỷ", "1,5 tỷ"
  const text = priceText.toLowerCase();

  // Match billions (tỷ)
  const billionMatch = text.match(/([\d.,]+)\s*t[yỷ]/);
  if (billionMatch) {
    const value = parseFloat(billionMatch[1].replace(',', '.'));
    return value * 1000; // Convert to millions
  }

  // Match millions (triệu)
  const millionMatch = text.match(/([\d.,]+)\s*tri[eệ]u/);
  if (millionMatch) {
    const value = parseFloat(millionMatch[1].replace(',', '.'));
    return value;
  }

  return null;
};

const setLoading = (flag, { silent = false } = {}) => {
  state.isLoading = flag;
  if (silent) {
    return;
  }

  // Show/hide loading element
  if (els.loading) {
    if (flag) {
      els.loading.classList.remove('hidden');
    } else {
      els.loading.classList.add('hidden');
    }
  }

  // Update refresh button if it exists
  if (els.refreshBtn) {
    els.refreshBtn.disabled = flag;
    els.refreshBtn.textContent = flag ? 'Đang tải...' : 'Làm mới dữ liệu';
  }
};

const renderStatus = () => {
  if (state.errors.length) {
    const failedNames = state.errors
      .map((error) => {
        const source = state.sources.find((src) => src.id === error.id);
        return source ? source.name : error.id;
      })
      .join(', ');
    els.statusMessage.textContent = `Không lấy được dữ liệu từ: ${failedNames}`;
    els.statusMessage.classList.add('error');
  } else if (!state.data.length) {
    els.statusMessage.textContent = 'Chưa có dữ liệu. Hãy bấm "Làm mới dữ liệu"';
    els.statusMessage.classList.remove('error');
  } else {
    els.statusMessage.textContent = 'Tất cả nguồn hoạt động bình thường.';
    els.statusMessage.classList.remove('error');
  }

  if (els.updatedAt && state.updatedAt) {
    els.updatedAt.textContent = `Cập nhật lúc: ${formatDate(state.updatedAt)}`;
  }
};



const handleSourceChange = (id, checked) => {
  if (checked) {
    state.filters.selectedSources.add(id);
  } else {
    state.filters.selectedSources.delete(id);
  }
  renderCars();
};


const renderSourceFilters = () => {
  const selected = state.filters.selectedSources;
  const availableIds = new Set(state.sources.map((source) => source.id));
  [...selected].forEach((id) => {
    if (!availableIds.has(id)) {
      selected.delete(id);
    }
  });

  els.sourceFilters.innerHTML = '';
  state.sources.forEach((source) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'source-checkbox-label';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = source.id;
    checkbox.checked = selected.has(source.id);
    checkbox.addEventListener('change', (event) => {
      handleSourceChange(source.id, event.target.checked);
    });

    const text = document.createElement('span');
    text.textContent = source.name;

    wrapper.appendChild(checkbox);
    wrapper.appendChild(text);
    els.sourceFilters.appendChild(wrapper);
  });
};

// Multi-select brand filter functions
const updateBrandOptions = () => {
  const counts = new Map();

  state.data.forEach((car) => {
    const slug = car.brandSlug || '';
    const name = car.brand || '';
    if (!slug || !name) return;
    if (!counts.has(slug)) {
      counts.set(slug, { slug, name, count: 0 });
    }
    counts.get(slug).count += 1;
  });

  state.brandOptions = [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));

  // Clean up selected brands that no longer exist
  const selected = state.filters.selectedBrands;
  [...selected].forEach((slug) => {
    if (!counts.has(slug)) {
      selected.delete(slug);
    }
  });
};

const renderBrandDropdown = (searchTerm = '') => {
  const selected = state.filters.selectedBrands;
  const filteredOptions = state.brandOptions.filter((option) =>
    option.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (filteredOptions.length === 0) {
    els.brandOptions.innerHTML = '<div class="dropdown-empty">Không tìm thấy thương hiệu</div>';
    return;
  }

  els.brandOptions.innerHTML = filteredOptions
    .map(
      (option) => `
      <div class="dropdown-option ${selected.has(option.slug) ? 'selected' : ''}" data-slug="${option.slug}">
        <input type="checkbox" ${selected.has(option.slug) ? 'checked' : ''} />
        <span class="dropdown-option-label">${option.name}</span>
        <span class="dropdown-option-count">${option.count}</span>
      </div>
    `
    )
    .join('');

  // Add event listeners to options
  els.brandOptions.querySelectorAll('.dropdown-option').forEach((option) => {
    option.addEventListener('click', (e) => {
      const slug = option.dataset.slug;
      const checkbox = option.querySelector('input[type="checkbox"]');
      const isSelected = selected.has(slug);

      if (isSelected) {
        selected.delete(slug);
        checkbox.checked = false;
        option.classList.remove('selected');
      } else {
        selected.add(slug);
        checkbox.checked = true;
        option.classList.add('selected');
      }

      renderBrandTags();
      renderCars();
    });
  });
};

const renderBrandTags = () => {
  const selected = state.filters.selectedBrands;
  const selectedBrands = state.brandOptions.filter((option) => selected.has(option.slug));

  if (selectedBrands.length === 0) {
    els.brandSelectedTags.innerHTML = '';
    els.brandSearchInput.placeholder = 'Tất cả hãng xe...';
    return;
  }

  els.brandSearchInput.placeholder = '';
  els.brandSelectedTags.innerHTML = selectedBrands
    .map(
      (brand) => `
      <span class="selected-tag">
        ${brand.name}
        <button type="button" data-slug="${brand.slug}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </span>
    `
    )
    .join('');

  // Add event listeners to remove buttons
  els.brandSelectedTags.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const slug = btn.dataset.slug;
      state.filters.selectedBrands.delete(slug);
      renderBrandTags();
      renderBrandDropdown(els.brandSearchInput.value);
      renderCars();
    });
  });
};

const toggleBrandDropdown = (open) => {
  state.brandDropdownOpen = open;
  if (open) {
    els.brandSelectInput.classList.add('active');
    els.brandDropdown.classList.add('active');
    els.brandSearchInput.focus();
  } else {
    els.brandSelectInput.classList.remove('active');
    els.brandDropdown.classList.remove('active');
    els.brandSearchInput.value = '';
    renderBrandDropdown('');
  }
};

const renderBrandFilters = () => {
  updateBrandOptions();
  renderBrandDropdown();
  renderBrandTags();
};

const filterCars = () => {
  const keyword = state.filters.keyword.toLowerCase();
  const selected = state.filters.selectedSources;
  const selectedBrands = state.filters.selectedBrands;
  const priceMin = state.filters.priceMin;
  const priceMax = state.filters.priceMax;

  return state.data.filter((car) => {
    // Source filter
    if (selected.size && !selected.has(car.source)) {
      return false;
    }

    // Brand filter
    if (selectedBrands.size) {
      const slug = car.brandSlug || '';
      if (!selectedBrands.has(slug)) {
        return false;
      }
    }

    // Price range filter
    if (priceMin !== null || priceMax !== null) {
      const carPrice = extractPrice(car.priceText);
      if (carPrice !== null) {
        if (priceMin !== null && carPrice < priceMin) {
          return false;
        }
        if (priceMax !== null && carPrice > priceMax) {
          return false;
        }
      }
    }

    // Keyword search
    if (!keyword) return true;

    const haystack = [
      car.title,
      car.priceText,
      car.sourceName,
      car.brand,
      ...(car.attributes || []).map((attr) => `${attr.label} ${attr.value}`)
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(keyword);
  });
};

const sortCars = (cars) => {
  const sorted = [...cars];

  switch (state.sortBy) {
    case 'price-asc':
      return sorted.sort((a, b) => {
        const priceA = extractPrice(a.priceText) || Infinity;
        const priceB = extractPrice(b.priceText) || Infinity;
        return priceA - priceB;
      });
    case 'price-desc':
      return sorted.sort((a, b) => {
        const priceA = extractPrice(a.priceText) || -Infinity;
        const priceB = extractPrice(b.priceText) || -Infinity;
        return priceB - priceA;
      });
    case 'brand':
      return sorted.sort((a, b) => {
        const brandA = a.brand || '';
        const brandB = b.brand || '';
        return brandA.localeCompare(brandB, 'vi');
      });
    case 'newest':
    default:
      return sorted;
  }
};

const renderCars = () => {
  const filtered = filterCars();
  const cars = sortCars(filtered);
  els.carCount.textContent = `Hiển thị ${cars.length} kết quả`;

  // Hide loading element when rendering cars
  if (els.loading) {
    els.loading.classList.add('hidden');
  }

  // Apply view mode
  if (state.viewMode === 'list') {
    els.carGrid.classList.add('list-view');
  } else {
    els.carGrid.classList.remove('list-view');
  }

  if (!cars.length) {
    els.carGrid.innerHTML = '<p class="muted">Không có dữ liệu phù hợp với bộ lọc hiện tại.</p>';
    return;
  }

  const cardHtml = cars
    .map((car) => {
      // Extract key specs from attributes
      const specs = {
        odometer: '',
        seats: '',
        transmission: '',
        fuel: '',
        year: '',
        location: ''
      };

      (car.attributes || []).forEach(attr => {
        const label = (attr.label || '').toLowerCase();
        const value = attr.value || '';

        if (label.includes('năm') || label.includes('year')) {
          specs.year = value;
        } else if (label.includes('km') || label.includes('odo') || label.includes('số km')) {
          specs.odometer = value;
        } else if (label.includes('nhiên liệu') || label.includes('fuel') || label.includes('động cơ')) {
          specs.fuel = value;
        } else if (label.includes('hộp số') || label.includes('transmission') || label.includes('số sàn') || label.includes('tự động')) {
          specs.transmission = value;
        } else if (label.includes('chỗ') || label.includes('seat')) {
          specs.seats = value;
        } else if (label.includes('địa chỉ') || label.includes('location') || label.includes('nơi bán') || label.includes('vị trí')) {
          specs.location = value;
        }
      });

      // Source badge
      const sourceLower = (car.source || '').toLowerCase();
      let sourceName = car.sourceName || car.source || '';
      if (sourceLower.includes('bonbanh')) {
        sourceName = 'Bonbanh';
      } else if (sourceLower.includes('chotot') || sourceLower.includes('chợ tốt')) {
        sourceName = 'Chợ Tốt';
      }

      // Build specs HTML - only show specs that have values
      const specsHtml = [];

      if (specs.odometer) {
        specsHtml.push(`
          <div class="car-spec-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>${escapeHtml(specs.odometer)}</span>
          </div>
        `);
      }

      if (specs.seats) {
        specsHtml.push(`
          <div class="car-spec-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            <span>${escapeHtml(specs.seats)}</span>
          </div>
        `);
      }

      if (specs.transmission) {
        specsHtml.push(`
          <div class="car-spec-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="4" width="20" height="16" rx="2"></rect>
              <path d="M6 8v8"></path>
              <path d="M18 8v8"></path>
              <path d="M6 12h12"></path>
            </svg>
            <span>${escapeHtml(specs.transmission)}</span>
          </div>
        `);
      }

      if (specs.fuel) {
        specsHtml.push(`
          <div class="car-spec-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 22V6c0-1.1.9-2 2-2h8c1.1 0 2 .9 2 2v16"></path>
              <path d="M3 22h12"></path>
              <path d="M18 14v4c0 1.1.9 2 2 2 0 0 0-6 0-10 0-2-3-2-3 0v3"></path>
              <rect x="6" y="7" width="5" height="4"></rect>
            </svg>
            <span>${escapeHtml(specs.fuel)}</span>
          </div>
        `);
      }

      if (specs.year) {
        specsHtml.push(`
          <div class="car-spec-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span>${escapeHtml(specs.year)}</span>
          </div>
        `);
      }

      if (specs.location || sourceName) {
        specsHtml.push(`
          <div class="car-spec-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            <span>${escapeHtml(specs.location || sourceName)}</span>
          </div>
        `);
      }

      return `
        <div class="car-card" onclick="document.querySelector('.detail-btn[data-car-id=\\'${escapeAttr(car.id)}\\']').click()">
          <div class="car-card-image">
            <img src="${escapeAttr(car.thumbnail || 'https://via.placeholder.com/400x250?text=No+Image')}" alt="${escapeAttr(car.title)}" loading="lazy" />
            <button class="car-image-nav prev" onclick="event.stopPropagation()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
            <button class="car-image-nav next" onclick="event.stopPropagation()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>
          <div class="car-card-content">
            <div class="car-price-banner">${escapeHtml(car.priceText || 'Liên hệ')}</div>
            <h3 class="car-title">${escapeHtml(car.title)}</h3>
            <div class="car-specs">
              ${specsHtml.join('')}
            </div>
          </div>
          <button class="detail-btn" type="button" data-car-id="${escapeAttr(car.id)}" style="display:none;">Xem Chi Tiết</button>
        </div>
      `;
    })
    .join('');

  els.carGrid.innerHTML = cardHtml;

  // Re-attach event listeners for detail buttons
  document.querySelectorAll('.detail-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const carId = btn.dataset.carId;
      const car = state.data.find((c) => c.id === carId);
      if (car) {
        openDetailModal(car);
      }
    });
  });
};

const buildSummaryGrid = (items = []) => {
  if (!Array.isArray(items) || !items.length) return '';
  return `
    <div class="detail-summary-grid">
      ${items
      .map(
        (item) => `
        <div class="detail-summary-item">
          <span>${escapeHtml(item.label || 'Thông tin')}</span>
          <strong>${escapeHtml(item.value || '---')}</strong>
        </div>
      `
      )
      .join('')}
    </div>
  `;
};

const buildSectionsHtml = (sections = []) => {
  if (!Array.isArray(sections) || !sections.length) return '';
  return sections
    .filter((section) => Array.isArray(section?.items) && section.items.length)
    .map(
      (section) => `
        <section class="detail-section">
          <h3>${escapeHtml(section.title || 'Thông tin')}</h3>
          <ul>
            ${section.items
          .map(
            (item) => `
                  <li>
                    <strong>${escapeHtml(item.label || 'Thông tin')}</strong>
                    ${escapeHtml(item.value || '---')}
                  </li>
                `
          )
          .join('')}
          </ul>
        </section>
      `
    )
    .join('');
};

const buildDescriptionBlock = (description = '') => {
  if (!description) return '';
  return `
    <section class="detail-section">
      <h3>Mô tả chi tiết</h3>
      <div class="detail-description">${formatMultiline(description)}</div>
    </section>
  `;
};

const buildDetailActions = (detail) => {
  const actions = [];
  if (detail.url) {
    actions.push(
      `<a class="detail-link external-link" href="${escapeAttr(detail.url)}" target="_blank" rel="noopener noreferrer">Mở trang gốc</a>`
    );
  }
  const hotlineLink = detail.contact?.hotlineLink;
  if (hotlineLink) {
    const label = detail.contact?.hotline ? `Gọi ${escapeHtml(detail.contact.hotline)}` : 'Gọi hotline';
    actions.push(`<a class="detail-link" href="${escapeAttr(hotlineLink)}">${label}</a>`);
  }
  if (detail.contact?.zaloUrl) {
    actions.push(
      `<a class="detail-link" href="${escapeAttr(detail.contact.zaloUrl)}" target="_blank" rel="noopener noreferrer">Chat Zalo</a>`
    );
  }
  return actions.length ? `<div class="detail-actions">${actions.join('')}</div>` : '';
};

const buildGalleryHtml = (detail) => {
  const images = Array.isArray(detail.gallery) ? detail.gallery : [];
  if (!images.length) return '';
  const [main, ...thumbs] = images;
  const thumbHtml = thumbs
    .map(
      (src, index) => `
        <button type="button" data-detail-thumb="true" data-src="${escapeAttr(src)}" class="${index === 0 ? 'active' : ''
        }" aria-label="Ảnh ${index + 2}">
          <img src="${escapeAttr(src)}" alt="${escapeHtml(`${detail.title || 'Ảnh xe'} ${index + 2}`)}" />
        </button>
      `
    )
    .join('');

  const arrowsHtml = images.length > 1 ? `
    <button class="gallery-nav prev" aria-label="Ảnh trước">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    </button>
    <button class="gallery-nav next" aria-label="Ảnh sau">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    </button>
  ` : '';

  return `
    <div class="detail-gallery">
      <div class="detail-gallery-main">
        ${arrowsHtml}
        <img src="${escapeAttr(main)}" alt="${escapeHtml(detail.title || 'Ảnh xe')}" data-detail-main />
      </div>
      ${thumbs.length ? `<div class="detail-gallery-thumbs">${thumbHtml}</div>` : ''}
    </div>
  `;
};

const renderDetailModal = () => {
  if (!els.detailModalContent) return;
  if (!state.detail.isOpen) {
    els.detailModal?.classList.remove('is-open');
    els.detailModal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    els.detailModalContent.innerHTML =
      '<div class="detail-modal-empty">Chọn một xe để xem thông tin chi tiết.</div>';
    return;
  }

  document.body.classList.add('modal-open');
  els.detailModal?.classList.add('is-open');
  els.detailModal?.setAttribute('aria-hidden', 'false');

  if (state.detail.isLoading) {
    els.detailModalContent.innerHTML = '<div class="detail-modal-loading">Đang tải thông tin xe...</div>';
    return;
  }

  if (state.detail.error) {
    els.detailModalContent.innerHTML = `<div class="detail-modal-error">${escapeHtml(state.detail.error)}</div>`;
    return;
  }

  if (!state.detail.data) {
    els.detailModalContent.innerHTML =
      '<div class="detail-modal-empty">Không tìm thấy dữ liệu chi tiết cho xe này.</div>';
    return;
  }

  const detail = state.detail.data;
  const sourceMeta = [];
  if (detail.sourceName) {
    sourceMeta.push(`<p class="detail-source">Nguồn: ${escapeHtml(detail.sourceName)}</p>`);
  }
  if (detail.scrapedAt) {
    sourceMeta.push(`<p class="detail-source">Cập nhật: ${escapeHtml(formatDate(detail.scrapedAt))}</p>`);
  }

  const summaryHtml = buildSummaryGrid(detail.summary);
  const sectionsHtml = buildSectionsHtml(detail.sections);
  const descriptionHtml = buildDescriptionBlock(detail.description);
  const galleryHtml = buildGalleryHtml(detail);
  const actionHtml = buildDetailActions(detail);

  els.detailModalContent.innerHTML = `
    <div class="detail-header">
      <h2>${escapeHtml(detail.title || 'Thông tin xe')}</h2>
      <p class="detail-price">${escapeHtml(detail.priceText || 'Liên hệ')}</p>
      ${sourceMeta.join('')}
      ${actionHtml}
    </div>
    ${galleryHtml}
    ${summaryHtml}
    ${sectionsHtml}
    ${descriptionHtml}
  `;
};

const closeDetailModal = () => {
  state.detail = {
    isOpen: false,
    isLoading: false,
    carId: null,
    data: null,
    error: ''
  };
  renderDetailModal();
};

const loadCarDetail = async (car) => {
  if (!car.url) {
    state.detail = { ...state.detail, isLoading: false, error: 'Xe này chưa có đường dẫn chi tiết.' };
    renderDetailModal();
    return;
  }
  const cacheKey = `${car.source || 'unknown'}|${car.url}`;
  const cached = detailCache.get(cacheKey);
  if (cached) {
    state.detail = { ...state.detail, isLoading: false, data: cached, error: '' };
    renderDetailModal();
    return;
  }

  try {
    const params = new URLSearchParams({ url: car.url });
    if (car.source) {
      params.set('source', car.source);
    }
    const response = await fetch(`/api/cars/detail?${params.toString()}`);
    if (!response.ok) {
      throw new Error('Không thể tải chi tiết xe');
    }
    const payload = await response.json();
    const detail = payload.data || null;
    if (!detail) {
      throw new Error('Không tìm thấy dữ liệu chi tiết');
    }
    detailCache.set(cacheKey, detail);
    state.detail = { ...state.detail, data: detail, error: '' };
  } catch (error) {
    console.error(error);
    state.detail = {
      ...state.detail,
      error: 'Không thể tải chi tiết xe. Vui lòng thử lại sau.'
    };
  } finally {
    state.detail = { ...state.detail, isLoading: false };
    renderDetailModal();
  }
};

const openDetailModal = (car) => {
  state.detail = {
    ...state.detail,
    isOpen: true,
    isLoading: true,
    carId: car?.id || null,
    data: null,
    error: ''
  };
  renderDetailModal();
  if (car) {
    loadCarDetail(car);
  }
};

const applyPayload = (payload) => {
  if (!payload) return;
  state.data = payload.data || [];
  state.sources = payload.sources || [];
  state.errors = payload.errors || [];
  state.updatedAt = payload.updatedAt || null;

  renderSourceFilters();
  renderBrandFilters();
  renderStatus();
  renderCars();
};

const hydrateFromCache = () => {
  const cached = dataCache.load();
  if (cached) {
    applyPayload(cached);
  }
};

const scheduleAutoReload = () => {
  if (state.autoReloadTimerId) {
    clearTimeout(state.autoReloadTimerId);
  }
  state.autoReloadTimerId = setTimeout(() => {
    fetchCars({ refresh: true, silent: true });
  }, AUTO_RELOAD_INTERVAL_MS);
};

const fetchCars = async ({ refresh = false, silent = false } = {}) => {
  setLoading(true, { silent });
  try {
    const query = refresh ? '?refresh=true' : '';
    const response = await fetch(`/api/cars${query}`);
    if (!response.ok) {
      throw new Error('Không thể tải dữ liệu');
    }
    const payload = await response.json();
    applyPayload(payload);
    dataCache.save(payload);
  } catch (error) {
    console.error(error);
    els.statusMessage.textContent = 'Không thể tải dữ liệu. Vui lòng thử lại sau.';
    els.statusMessage.classList.add('error');
  } finally {
    setLoading(false, { silent });
    scheduleAutoReload();
  }
};

// Event listeners
els.searchInput.addEventListener('input', (event) => {
  state.filters.keyword = event.target.value || '';
  renderCars();
});

// Price range filters
let priceTimeout;
const handlePriceChange = () => {
  clearTimeout(priceTimeout);
  priceTimeout = setTimeout(() => {
    const min = parseFloat(els.priceMin.value);
    const max = parseFloat(els.priceMax.value);
    state.filters.priceMin = !isNaN(min) && min > 0 ? min : null;
    state.filters.priceMax = !isNaN(max) && max > 0 ? max : null;
    renderCars();
  }, 500); // Debounce for 500ms
};

els.priceMin.addEventListener('input', handlePriceChange);
els.priceMax.addEventListener('input', handlePriceChange);

// Sort select
els.sortSelect.addEventListener('change', (event) => {
  state.sortBy = event.target.value;
  renderCars();
});

// View mode toggle
if (els.viewGrid) {
  els.viewGrid.addEventListener('click', () => {
    state.viewMode = 'grid';
    els.viewGrid.classList.add('active');
    if (els.viewList) {
      els.viewList.classList.remove('active');
    }
    renderCars();
  });
}

if (els.viewList) {
  els.viewList.addEventListener('click', () => {
    state.viewMode = 'list';
    els.viewList.classList.add('active');
    if (els.viewGrid) {
      els.viewGrid.classList.remove('active');
    }
    renderCars();
  });
}



// Brand multi-select dropdown
els.brandSelectInput.addEventListener('click', (e) => {
  if (e.target === els.brandSearchInput) return;
  toggleBrandDropdown(!state.brandDropdownOpen);
});

els.brandSearchInput.addEventListener('input', (e) => {
  renderBrandDropdown(e.target.value);
});

els.brandSearchInput.addEventListener('focus', () => {
  toggleBrandDropdown(true);
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (
    !els.brandSelectInput.contains(e.target) &&
    !els.brandDropdown.contains(e.target) &&
    state.brandDropdownOpen
  ) {
    toggleBrandDropdown(false);
  }
});

if (els.carGrid) {
  els.carGrid.addEventListener('click', (event) => {
    const button = event.target.closest('.detail-btn');
    if (!button) return;
    const car = state.data.find((item) => item.id === button.dataset.carId);
    if (!car) return;
    event.preventDefault();
    openDetailModal(car);
  });
}

if (els.detailModalClose) {
  els.detailModalClose.addEventListener('click', () => closeDetailModal());
}

if (els.detailModalOverlay) {
  els.detailModalOverlay.addEventListener('click', () => closeDetailModal());
}

if (els.detailModalContent) {
  els.detailModalContent.addEventListener('click', (event) => {
    // Handle thumbnail click
    const thumb = event.target.closest('[data-detail-thumb]');
    if (thumb) {
      const targetSrc = thumb.dataset.src;
      const mainImage = els.detailModalContent.querySelector('[data-detail-main]');
      if (targetSrc && mainImage) {
        mainImage.src = targetSrc;
        els.detailModalContent.querySelectorAll('[data-detail-thumb]').forEach((node) => {
          node.classList.toggle('active', node === thumb);
        });
      }
      return;
    }

    // Handle main image click (next image)
    if (event.target.closest('[data-detail-main]')) {
      const thumbs = Array.from(els.detailModalContent.querySelectorAll('[data-detail-thumb]'));
      if (!thumbs.length) return;

      const currentIndex = thumbs.findIndex(t => t.classList.contains('active'));
      const nextIndex = (currentIndex + 1) % thumbs.length;
      const nextThumb = thumbs[nextIndex];

      if (nextThumb) {
        nextThumb.click();
      }
    }

    // Handle gallery navigation arrows
    const navBtn = event.target.closest('.gallery-nav');
    if (navBtn) {
      const thumbs = Array.from(els.detailModalContent.querySelectorAll('[data-detail-thumb]'));
      if (!thumbs.length) return;

      const currentIndex = thumbs.findIndex(t => t.classList.contains('active'));
      let nextIndex;

      if (navBtn.classList.contains('prev')) {
        nextIndex = (currentIndex - 1 + thumbs.length) % thumbs.length;
      } else {
        nextIndex = (currentIndex + 1) % thumbs.length;
      }

      const nextThumb = thumbs[nextIndex];
      if (nextThumb) {
        nextThumb.click();
      }
    }
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.detail.isOpen) {
    closeDetailModal();
  }
});

if (els.refreshBtn) {
  els.refreshBtn.addEventListener('click', () => fetchCars({ refresh: true }));
}

// Reset filters
const resetFiltersBtn = document.getElementById('reset-filters-btn');
if (resetFiltersBtn) {
  resetFiltersBtn.addEventListener('click', () => {
    state.filters.keyword = '';
    state.filters.selectedSources.clear();
    state.filters.selectedBrands.clear();
    state.filters.priceMin = null;
    state.filters.priceMax = null;

    // Reset UI inputs
    els.searchInput.value = '';
    els.priceMin.value = '';
    els.priceMax.value = '';
    els.brandSearchInput.value = '';

    // Reset checkboxes
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('.source-toggle').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.dropdown-option').forEach(el => el.classList.remove('selected'));

    renderBrandTags();
    renderCars();
  });
}

hydrateFromCache();
renderDetailModal();
fetchCars();

// Mobile menu toggle
const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
const mainNav = document.getElementById('main-nav');

if (mobileMenuToggle && mainNav) {
  mobileMenuToggle.addEventListener('click', () => {
    mainNav.classList.toggle('open');
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!mainNav.contains(e.target) && !mobileMenuToggle.contains(e.target) && mainNav.classList.contains('open')) {
      mainNav.classList.remove('open');
    }
  });
}

// ========================================
// TRAFFIC FINE CHECKER
// ========================================

const trafficFineEls = {
  section: document.getElementById('traffic-fine-section'),
  filtersSidebar: document.getElementById('filters-sidebar'),
  resultsArea: document.querySelector('.results-area'),
  licensePlateInput: document.getElementById('license-plate-input'),
  checkFineBtn: document.getElementById('check-fine-btn'),
  fineResult: document.getElementById('fine-result'),
  fineLoading: document.getElementById('fine-loading'),
  captchaContainer: document.getElementById('fine-captcha-container'),
  captchaImage: document.getElementById('captcha-image'),
  captchaInput: document.getElementById('captcha-input'),
  reloadCaptchaBtn: document.getElementById('reload-captcha-btn'),
  methodIframeBtn: document.getElementById('method-iframe-btn'),
  methodManualBtn: document.getElementById('method-manual-btn'),
  iframeMethod: document.getElementById('iframe-method'),
  manualMethod: document.getElementById('manual-method')
};

// Method switching buttons
if (trafficFineEls.methodIframeBtn && trafficFineEls.methodManualBtn) {
  trafficFineEls.methodIframeBtn.addEventListener('click', () => {
    // Show iframe method
    trafficFineEls.iframeMethod.style.display = 'block';
    trafficFineEls.manualMethod.style.display = 'none';

    // Update button styles
    trafficFineEls.methodIframeBtn.classList.add('active');
    trafficFineEls.methodIframeBtn.style.background = 'var(--gold)';
    trafficFineEls.methodIframeBtn.style.color = 'var(--black)';
    trafficFineEls.methodIframeBtn.style.border = 'none';

    trafficFineEls.methodManualBtn.classList.remove('active');
    trafficFineEls.methodManualBtn.style.background = 'var(--bg-secondary)';
    trafficFineEls.methodManualBtn.style.color = 'var(--white)';
    trafficFineEls.methodManualBtn.style.border = '2px solid var(--border-medium)';
  });

  trafficFineEls.methodManualBtn.addEventListener('click', () => {
    // Show manual method
    trafficFineEls.iframeMethod.style.display = 'none';
    trafficFineEls.manualMethod.style.display = 'block';

    // Update button styles
    trafficFineEls.methodManualBtn.classList.add('active');
    trafficFineEls.methodManualBtn.style.background = 'var(--gold)';
    trafficFineEls.methodManualBtn.style.color = 'var(--black)';
    trafficFineEls.methodManualBtn.style.border = 'none';

    trafficFineEls.methodIframeBtn.classList.remove('active');
    trafficFineEls.methodIframeBtn.style.background = 'var(--bg-secondary)';
    trafficFineEls.methodIframeBtn.style.color = 'var(--white)';
    trafficFineEls.methodIframeBtn.style.border = '2px solid var(--border-medium)';

    // Load CAPTCHA when switching to manual
    loadCaptcha();
  });
}

// Load CAPTCHA image
function loadCaptcha() {
  if (trafficFineEls.captchaImage) {
    trafficFineEls.captchaImage.src = `/api/captcha?t=${Date.now()}`;
    trafficFineEls.captchaContainer.style.display = 'flex';
    if (trafficFineEls.captchaInput) {
      trafficFineEls.captchaInput.value = '';
    }
  }
}

// Reload CAPTCHA button
if (trafficFineEls.reloadCaptchaBtn) {
  trafficFineEls.reloadCaptchaBtn.addEventListener('click', () => {
    loadCaptcha();
  });
}

// View switching
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const view = link.getAttribute('data-view');

    if (view === 'traffic-fine') {
      // Show traffic fine section, hide cars section
      trafficFineEls.section.style.display = 'block';
      trafficFineEls.filtersSidebar.style.display = 'none';
      trafficFineEls.resultsArea.style.display = 'none';

      // Add traffic-fine class to main container
      const mainContainer = document.querySelector('.main-container');
      if (mainContainer) {
        mainContainer.classList.add('traffic-fine');
      }

      // Clear previous results
      trafficFineEls.fineResult.style.display = 'none';
      if (trafficFineEls.licensePlateInput) {
        trafficFineEls.licensePlateInput.value = '';
      }

      // Don't load CAPTCHA by default - user will click manual method if needed
    } else {
      // Show cars section, hide traffic fine section
      trafficFineEls.section.style.display = 'none';
      trafficFineEls.filtersSidebar.style.display = 'block';
      trafficFineEls.resultsArea.style.display = 'block';

      // Remove traffic-fine class from main container
      const mainContainer = document.querySelector('.main-container');
      if (mainContainer) {
        mainContainer.classList.remove('traffic-fine');
      }
    }
  });
});

// Format license plate input
if (trafficFineEls.licensePlateInput) {
  trafficFineEls.licensePlateInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  // Allow Enter key to trigger check
  trafficFineEls.licensePlateInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      trafficFineEls.checkFineBtn.click();
    }
  });
}

// Allow Enter key in captcha input
if (trafficFineEls.captchaInput) {
  trafficFineEls.captchaInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      trafficFineEls.checkFineBtn.click();
    }
  });
}

// Check fine button
if (trafficFineEls.checkFineBtn) {
  trafficFineEls.checkFineBtn.addEventListener('click', async () => {
    const licensePlate = trafficFineEls.licensePlateInput.value.trim();
    const captcha = trafficFineEls.captchaInput ? trafficFineEls.captchaInput.value.trim() : '';

    if (!licensePlate) {
      alert('Vui lòng nhập biển số xe');
      return;
    }

    if (!captcha) {
      alert('Vui lòng nhập mã xác nhận');
      trafficFineEls.captchaInput?.focus();
      return;
    }

    // Show loading
    trafficFineEls.fineLoading.style.display = 'block';
    trafficFineEls.fineResult.style.display = 'none';
    trafficFineEls.checkFineBtn.disabled = true;

    try {
      const response = await fetch('/api/check-fine', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ licensePlate, captcha })
      });

      const data = await response.json();

      // If CAPTCHA is required or incorrect, reload it
      if (data.requiresCaptcha || (data.error && data.error.includes('captcha'))) {
        loadCaptcha();
        throw new Error('Mã xác nhận không chính xác. Vui lòng thử lại.');
      }

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Không thể kiểm tra phạt nguội');
      }

      renderFineResult(data);

      // Clear captcha input after successful check
      if (trafficFineEls.captchaInput) {
        trafficFineEls.captchaInput.value = '';
      }

      // Reload CAPTCHA for next check
      loadCaptcha();
    } catch (error) {
      console.error('Error checking fine:', error);
      trafficFineEls.fineResult.innerHTML = `
        <div class="fine-no-violation">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
          <h3>Lỗi Tra Cứu</h3>
          <p>${error.message}</p>
        </div>
      `;
      trafficFineEls.fineResult.style.display = 'block';
    } finally {
      trafficFineEls.fineLoading.style.display = 'none';
      trafficFineEls.checkFineBtn.disabled = false;
    }
  });
}

function renderFineResult(data) {
  const { licensePlate, violations, totalFines, count, checkedAt, isDemo, message } = data;

  if (count === 0) {
    trafficFineEls.fineResult.innerHTML = `
      <div class="fine-no-violation">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M9 12l2 2 4-4"></path>
        </svg>
        <h3>Không Có Vi Phạm</h3>
        <p>${message || 'Xe chưa có vi phạm nào được ghi nhận'}</p>
        ${isDemo ? `
          <div class="fine-demo-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            Dữ liệu demo
          </div>
        ` : ''}
      </div>
    `;
  } else {
    const violationsHtml = violations.map((v, index) => `
      <div class="fine-violation-item">
        <div class="fine-violation-header">
          <span class="fine-violation-id">#${v.id || `V${String(index + 1).padStart(3, '0')}`}</span>
          <span class="fine-violation-amount">${formatViolationCurrency(v.fine)}</span>
        </div>

        <div class="fine-violation-date-time">
          <div class="fine-violation-date">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span>${formatViolationDate(v.date)}</span>
          </div>
          <div class="fine-violation-time">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>${v.time}</span>
          </div>
        </div>

        <div class="fine-violation-location">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
            <circle cx="12" cy="10" r="3"></circle>
          </svg>
          <span>${v.location}</span>
        </div>

        <div class="fine-violation-description">
          ${v.violation}
        </div>

        <div class="fine-violation-footer">
          <span class="fine-violation-authority">${v.authority || 'CSGT'}</span>
          <span class="fine-violation-status ${v.status === 'Đã xử lý' ? 'paid' : ''}">${v.status}</span>
        </div>
      </div>
    `).join('');

    trafficFineEls.fineResult.innerHTML = `
      <div class="fine-result-header">
        <div class="fine-result-info">
          <div class="fine-license-plate">${licensePlate}</div>
          <div class="fine-checked-at">Tra cứu lúc: ${formatViolationDateTime(checkedAt)}</div>
          ${isDemo ? `
            <div class="fine-demo-badge" style="margin-top: 0.5rem;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              Dữ liệu demo
            </div>
          ` : ''}
        </div>
        <div class="fine-summary">
          <div class="fine-count">${count}</div>
          <div class="fine-total-label">Vi phạm chưa xử lý</div>
          <div class="fine-total-amount">${formatViolationCurrency(totalFines)}</div>
        </div>
      </div>
      <div class="fine-violations-list">
        ${violationsHtml}
      </div>
    `;
  }

  trafficFineEls.fineResult.style.display = 'block';
}

function formatViolationCurrency(amount) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND'
  }).format(amount);
}

function formatViolationDate(dateStr) {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

function formatViolationDateTime(dateTimeStr) {
  const date = new Date(dateTimeStr);
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}
