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
      // Extract key specs
      const keySpecs = {};
      (car.attributes || []).forEach(attr => {
        const label = (attr.label || '').toLowerCase();
        if (label.includes('năm') || label.includes('year')) keySpecs.year = attr.value;
        if (label.includes('km') || label.includes('odo') || label.includes('số km')) keySpecs.odometer = attr.value;
        if (label.includes('nhiên liệu') || label.includes('fuel')) keySpecs.fuel = attr.value;
        if (label.includes('hộp số') || label.includes('transmission')) keySpecs.transmission = attr.value;
      });

      // Source Badge Logic
      const sourceLower = (car.source || '').toLowerCase();
      let sourceClass = 'other';
      let sourceName = car.source || 'N/A';
      if (sourceLower.includes('bonbanh')) {
        sourceClass = 'bonbanh';
        sourceName = 'Bonbanh';
      } else if (sourceLower.includes('chotot') || sourceLower.includes('chợ tốt')) {
        sourceClass = 'chotot';
        sourceName = 'Chợ Tốt';
      }

      // Price Indicator Logic (Simple Heuristic)
      // In a real app, this would compare against market average
      const priceVal = parseInt((car.priceText || '0').replace(/\D/g, ''));
      const priceClass = priceVal > 0 && priceVal < 800 ? 'good' : 'high';

      // Attributes List (Max 4 items)
      const attrs = [];
      if (keySpecs.year) {
        attrs.push(`<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> ${escapeHtml(keySpecs.year)}</li>`);
      }
      if (keySpecs.odometer) {
        attrs.push(`<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> ${escapeHtml(keySpecs.odometer)}</li>`);
      }
      if (keySpecs.fuel) {
        attrs.push(`<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 19V5c0-1.1.9-2 2-2h9c1.1 0 2 .9 2 2v14H3z"></path><path d="M18 8v8"></path><path d="M21 8v8"></path></svg> ${escapeHtml(keySpecs.fuel)}</li>`);
      }
      if (keySpecs.transmission) {
        attrs.push(`<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"></circle><path d="M12 2v8"></path><path d="M12 14v8"></path></svg> ${escapeHtml(keySpecs.transmission)}</li>`);
      }

      const detailButton = `<button class="detail-link detail-btn" type="button" data-car-id="${escapeAttr(car.id)}">
        Xem Chi Tiết
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>`;

      return `
        <div class="car-card" onclick="document.querySelector('.detail-btn[data-car-id=\\'${escapeAttr(car.id)}\\']').click()">
          <div class="image-container">
            <img src="${escapeAttr(car.thumbnail || 'https://via.placeholder.com/300x200?text=No+Image')}" alt="${escapeAttr(car.title)}" loading="lazy" />
          </div>
          <div class="card-body">
            <div class="card-header">
              <span class="source-badge ${sourceClass}">${escapeHtml(sourceName)}</span>
            </div>
            <h3 class="car-title">${escapeHtml(car.title)}</h3>
            <div class="price">
              <span class="price-indicator ${priceClass}"></span>
              ${escapeHtml(car.priceText || 'Liên hệ')}
            </div>
            <ul class="attributes">
              ${attrs.join('')}
            </ul>
            <div class="card-footer">
              ${detailButton}
            </div>
          </div>
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
      const car = state.data.find((c) => c.id === carId); // Changed state.cars to state.data
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
