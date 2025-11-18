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
  autoReloadTimerId: null
};

const els = {
  carGrid: document.getElementById('car-grid'),
  carCount: document.getElementById('car-count'),
  sourceSummary: document.getElementById('source-summary'),
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
  toggleFilters: document.getElementById('toggle-filters'),
  filterPanel: document.querySelector('.filter-panel'),
  brandSelectInput: document.getElementById('brand-select-input'),
  brandSearchInput: document.getElementById('brand-search-input'),
  brandDropdown: document.getElementById('brand-dropdown'),
  brandOptions: document.getElementById('brand-options'),
  brandSelectedTags: document.getElementById('brand-selected-tags')
};

const placeholderImage = 'https://placehold.co/600x400?text=No+Image';
const CACHE_KEY = 'scanCar:data';
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const AUTO_RELOAD_INTERVAL_MS = CACHE_TTL_MS;

const dataCache = {
  save(payload) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          payload,
          cachedAt: Date.now()
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
  els.refreshBtn.disabled = flag;
  els.refreshBtn.textContent = flag ? 'Đang tải...' : 'Làm mới dữ liệu';
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

  els.updatedAt.textContent = formatDate(state.updatedAt);
};

const renderSourceSummary = () => {
  els.sourceSummary.innerHTML = state.sources
    .map(
      (source) => `
        <div class="source-card">
          <div class="status-chip ${source.status}">${source.status === 'ok' ? 'Hoạt động' : 'Lỗi'}</div>
          <h3>${source.name}</h3>
          <p class="muted">${source.count} xe</p>
        </div>
      `
    )
    .join('');
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
    wrapper.className = `source-toggle ${selected.has(source.id) ? 'active' : ''}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = source.id;
    checkbox.checked = selected.has(source.id);
    checkbox.addEventListener('change', (event) => {
      wrapper.classList.toggle('active', event.target.checked);
      handleSourceChange(source.id, event.target.checked);
    });

    const text = document.createElement('span');
    text.textContent = `${source.name} (${source.count})`;

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
    els.brandSearchInput.placeholder = 'Chọn thương hiệu...';
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
  els.carCount.textContent = `${cars.length} xe phù hợp`;

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
      const attrs =
        (car.attributes || [])
          .slice(0, 6)
          .map((attr) => `<li><strong>${attr.label}:</strong> ${attr.value}</li>`)
          .join('') || '<li>Chưa cập nhật thêm thông tin</li>';

      const titleMarkup = car.url
        ? `<a href="${car.url}" target="_blank" rel="noopener noreferrer">${car.title}</a>`
        : `<span>${car.title}</span>`;
      const brandTag = car.brand ? `<p class="tag secondary">${car.brand}</p>` : '';
      const detailLink = car.url
        ? `<a class="detail-link" href="${car.url}" target="_blank" rel="noopener noreferrer">Xem chi tiết</a>`
        : '';

      return `
        <article class="car-card">
          <div class="image-container">
            <img src="${car.thumbnail || placeholderImage}" alt="${car.title}" loading="lazy" />
          </div>
          <div class="card-body">
            <div class="tag-stack">
              <p class="tag">${car.sourceName}</p>
              ${brandTag}
            </div>
            <h3 class="car-title">${titleMarkup}</h3>
            <div class="price">${car.priceText || 'Liên hệ'}</div>
            <ul class="attributes">${attrs}</ul>
            <div class="card-footer">
              ${detailLink}
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  els.carGrid.innerHTML = cardHtml;
};

const applyPayload = (payload) => {
  if (!payload) return;
  state.data = payload.data || [];
  state.sources = payload.sources || [];
  state.errors = payload.errors || [];
  state.updatedAt = payload.updatedAt || null;

  renderSourceSummary();
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
els.viewGrid.addEventListener('click', () => {
  state.viewMode = 'grid';
  els.viewGrid.classList.add('active');
  els.viewList.classList.remove('active');
  renderCars();
});

els.viewList.addEventListener('click', () => {
  state.viewMode = 'list';
  els.viewList.classList.add('active');
  els.viewGrid.classList.remove('active');
  renderCars();
});

// Toggle filter panel
els.toggleFilters.addEventListener('click', () => {
  els.filterPanel.classList.toggle('collapsed');
  const isCollapsed = els.filterPanel.classList.contains('collapsed');
  els.toggleFilters.setAttribute('title', isCollapsed ? 'Hiện bộ lọc' : 'Ẩn bộ lọc');
});

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

els.refreshBtn.addEventListener('click', () => fetchCars({ refresh: true }));

hydrateFromCache();
fetchCars();
