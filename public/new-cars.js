(() => {
  const els = {
    tableBody: document.getElementById('price-table-body'),
    brandSelect: document.getElementById('brand-select'),
    keywordInput: document.getElementById('keyword-input'),
    statusText: document.getElementById('status-text'),
    updatedAt: document.getElementById('updated-at'),
    carCount: document.getElementById('car-count'),
    filterToggle: document.getElementById('filter-toggle'),
    filterPanel: document.getElementById('filter-panel'),
    filterBackdrop: document.getElementById('filter-backdrop'),
    modelSearch: document.getElementById('model-search'),
    modelList: document.getElementById('model-list'),
    priceMin: document.getElementById('price-min'),
    priceMax: document.getElementById('price-max'),
    applyFilters: document.getElementById('apply-filters'),
    clearFilters: document.getElementById('clear-filters'),
    filterTabs: document.querySelectorAll('.filter-tab'),
    filterContents: document.querySelectorAll('.filter-content'),
    refreshBtn: document.getElementById('refresh-data'),
    mainNav: document.getElementById('main-nav'),
    mobileMenuToggle: document.getElementById('mobile-menu-toggle')
  };

  const state = {
    cars: [],
    filtered: [],
    brand: 'all',
    keyword: '',
    selectedModels: new Set(),
    modelSearch: '',
    priceMin: '',
    priceMax: '',
    activeTab: 'models',
    updatedAt: null,
    loading: false
  };

  const slugify = (value = '') =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  const escapeHtml = (value = '') =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const escapeAttr = (value = '') => escapeHtml(value);

  const formatDate = (value) => {
    if (!value) return 'Cập nhật: --';
    try {
      const formatted = new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'short',
        timeStyle: 'short'
      }).format(new Date(value));
      return `Cập nhật: ${formatted}`;
    } catch (error) {
      return `Cập nhật: ${value}`;
    }
  };

  const parsePriceToVnd = (text = '') => {
    const normalized = String(text).toLowerCase();
    const parseNumber = (value) => {
      const number = Number(value.replace(/\./g, '').replace(/,/g, '.'));
      return Number.isFinite(number) ? number : null;
    };

    let total = 0;
    const tyMatch = normalized.match(/([\d.,]+)\s*tỷ/);
    const trieuMatch = normalized.match(/([\d.,]+)\s*triệu/);

    if (tyMatch) {
      const val = parseNumber(tyMatch[1]);
      if (val !== null) {
        total += val * 1_000_000_000;
      }
    }
    if (trieuMatch) {
      const val = parseNumber(trieuMatch[1]);
      if (val !== null) {
        total += val * 1_000_000;
      }
    }

    if (!total) {
      const digits = normalized.replace(/[^\d]/g, '');
      const guessed = Number(digits);
      if (Number.isFinite(guessed) && guessed > 0) {
        total = guessed >= 1_000_000_000 ? guessed : guessed * 1_000_000;
      }
    }
    return total || null;
  };

  const getAttrValue = (car, label) =>
    (car?.attributes || []).find((item) => item && item.label === label)?.value || '';

  const formatMoney = (value = 0) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value);
  const formatNumber = (value = 0) =>
    new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value);

  const buildLoanLink = (car) => {
    const params = new URLSearchParams();
    const amount = Math.round(car.priceValue || 0);
    if (amount > 0) params.set('price', amount);
    if (car.title) params.set('title', car.title);
    return `/loan.html${params.toString() ? `?${params.toString()}` : ''}`;
  };

  const deriveModel = (title = '', brand = '') => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return '';
    if (!brand) return trimmedTitle;

    const pattern = new RegExp(`^${brand}\\s+`, 'i');
    const stripped = trimmedTitle.replace(pattern, '').trim();
    return stripped || trimmedTitle;
  };

  const enhanceCar = (car) => {
    const version = car.version || getAttrValue(car, 'Phiên bản');
    const segment = car.segment || getAttrValue(car, 'Phân khúc');
    const engine = car.engine || getAttrValue(car, 'Động cơ');
    const negotiate = car.negotiate || getAttrValue(car, 'Đàm phán');
    const model = car.model || deriveModel(car.title, car.brand);
    const brandSlug = car.brandSlug || slugify(car.brand || '');
    const priceValue = parsePriceToVnd(car.priceText);

    return {
      ...car,
      model,
      version,
      segment,
      engine,
      negotiate,
      brandSlug,
      priceValue
    };
  };

  const setStatus = (message) => {
    if (els.statusText) {
      els.statusText.textContent = message;
    }
  };

  const setUpdatedAt = (value) => {
    state.updatedAt = value;
    if (els.updatedAt) {
      els.updatedAt.textContent = formatDate(value);
    }
  };

  const renderBrandOptions = () => {
    if (!els.brandSelect) return;
    const options = [];
    const seen = new Map();

    state.cars.forEach((car) => {
      if (!car.brandSlug || !car.brand) return;
      if (!seen.has(car.brandSlug)) {
        seen.set(car.brandSlug, car.brand);
      }
    });

    const sorted = [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'));
    options.push('<option value="all">Tất cả hãng</option>');
    sorted.forEach(([slug, name]) => {
      const selected = state.brand === slug ? 'selected' : '';
      options.push(`<option value="${slug}" ${selected}>${name}</option>`);
    });

    els.brandSelect.innerHTML = options.join('');
  };

  const getModelOptions = () => {
    const options = new Map();
    state.cars.forEach((car) => {
      if (state.brand !== 'all' && car.brandSlug !== state.brand) return;
      const name = car.model || car.title || 'Khác';
      if (!options.has(name)) {
        options.set(name, { name, count: 0 });
      }
      options.get(name).count += 1;
    });
    return [...options.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  };

  const renderModelOptions = () => {
    if (!els.modelList) return;
    const search = (state.modelSearch || '').toLowerCase();
    const options = getModelOptions().filter((opt) => opt.name.toLowerCase().includes(search));

    const items = [];
    items.push(
      `<label class="model-option" data-value="__all">
        <input type="checkbox" ${state.selectedModels.size === 0 ? 'checked' : ''} />
        <span>Chọn tất cả</span>
      </label>`
    );

    options.forEach((opt) => {
      const checked = state.selectedModels.has(opt.name) ? 'checked' : '';
      items.push(
        `<label class="model-option" data-value="${escapeAttr(opt.name)}">
          <input type="checkbox" ${checked} />
          <span>${escapeHtml(opt.name)}</span>
          <span class="model-count">${opt.count}</span>
        </label>`
      );
    });

    els.modelList.innerHTML = items.join('');
  };

  const closeFilterPanel = () => {
    if (els.filterPanel) {
      els.filterPanel.classList.remove('open');
    }
    if (els.filterBackdrop) {
      els.filterBackdrop.classList.add('hidden');
    }
    if (els.filterToggle) {
      els.filterToggle.classList.remove('is-active');
    }
  };

  const openFilterPanel = () => {
    if (els.filterPanel) {
      els.filterPanel.classList.add('open');
    }
    if (els.filterBackdrop) {
      els.filterBackdrop.classList.remove('hidden');
    }
    if (els.filterToggle) {
      els.filterToggle.classList.add('is-active');
    }
    if (els.priceMin) {
      els.priceMin.value = state.priceMin;
    }
    if (els.priceMax) {
      els.priceMax.value = state.priceMax;
    }
  };

  const renderTable = () => {
    if (!els.tableBody) return;
    if (!state.filtered.length) {
      els.tableBody.innerHTML = `<tr><td colspan="6" class="empty">Không tìm thấy xe phù hợp.</td></tr>`;
      return;
    }

    const rows = state.filtered.map((car) => {
      const negotiate = car.negotiate || getAttrValue(car, 'Đàm phán') || '---';
      const version = car.version || getAttrValue(car, 'Phiên bản') || '---';
      const segment = car.segment || getAttrValue(car, 'Phân khúc') || '---';
      const loanLink = buildLoanLink(car);

      return `
        <tr>
          <td>${escapeHtml(car.brand || '---')}</td>
          <td>${escapeHtml(car.model || car.title || '---')}</td>
          <td>${escapeHtml(version)}</td>
          <td>${escapeHtml(segment)}</td>
          <td class="price-col"><strong>${escapeHtml(car.priceText || 'Liên hệ')}</strong></td>
          <td class="note-col"><span title="${escapeAttr(negotiate)}">${escapeHtml(negotiate)}</span></td>
          <td class="action-col"><a class="loan-link" href="${escapeAttr(loanLink)}">Xem trả góp</a></td>
        </tr>
      `;
    });

    els.tableBody.innerHTML = rows.join('');
  };

  const applyFilters = () => {
    const keyword = (state.keyword || '').toLowerCase();
    const min = state.priceMin ? Number(state.priceMin) * 1_000_000 : null;
    const max = state.priceMax ? Number(state.priceMax) * 1_000_000 : null;
    const selectedModels = state.selectedModels;

    const filtered = state.cars.filter((car) => {
      if (state.brand !== 'all' && car.brandSlug !== state.brand) return false;
      if (selectedModels.size > 0 && !selectedModels.has(car.model)) return false;

      if (keyword) {
        const haystack = `${car.brand} ${car.model} ${car.version}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }

      if (min !== null && (car.priceValue === null || car.priceValue < min)) return false;
      if (max !== null && (car.priceValue === null || car.priceValue > max)) return false;

      return true;
    });

    filtered.sort((a, b) => {
      const brandCompare = (a.brand || '').localeCompare(b.brand || '', 'vi');
      if (brandCompare !== 0) return brandCompare;
      return (a.model || '').localeCompare(b.model || '', 'vi');
    });

    state.filtered = filtered;
    const countText = `${filtered.length} mẫu`;
    if (els.carCount) {
      els.carCount.textContent = `${filtered.length} / ${state.cars.length} xe`;
    }
    setStatus(filtered.length ? countText : 'Không có kết quả phù hợp');
    renderTable();
  };

  const resetFilters = () => {
    state.keyword = '';
    state.selectedModels.clear();
    state.priceMin = '';
    state.priceMax = '';
    state.modelSearch = '';
    if (els.keywordInput) els.keywordInput.value = '';
    if (els.modelSearch) els.modelSearch.value = '';
    if (els.priceMin) els.priceMin.value = '';
    if (els.priceMax) els.priceMax.value = '';
    renderModelOptions();
    applyFilters();
  };

  const switchTab = (tab) => {
    state.activeTab = tab;
    els.filterTabs.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    els.filterContents.forEach((content) => {
      content.classList.toggle('hidden', content.dataset.tabContent !== tab);
    });
  };

  const bindEvents = () => {
    if (els.mobileMenuToggle && els.mainNav) {
      els.mobileMenuToggle.addEventListener('click', () => {
        els.mainNav.classList.toggle('open');
      });
      document.addEventListener('click', (e) => {
        if (!els.mainNav.contains(e.target) && !els.mobileMenuToggle.contains(e.target)) {
          els.mainNav.classList.remove('open');
        }
      });
    }

    if (els.brandSelect) {
      els.brandSelect.addEventListener('change', (e) => {
        state.brand = e.target.value;
        state.selectedModels.clear();
        renderModelOptions();
        applyFilters();
      });
    }

    if (els.keywordInput) {
      els.keywordInput.addEventListener('input', (e) => {
        state.keyword = e.target.value || '';
        applyFilters();
      });
    }

    if (els.filterToggle) {
      els.filterToggle.addEventListener('click', () => {
        if (els.filterPanel?.classList.contains('open')) {
          closeFilterPanel();
        } else {
          openFilterPanel();
        }
      });
    }

    if (els.filterBackdrop) {
      els.filterBackdrop.addEventListener('click', closeFilterPanel);
    }

    els.filterTabs.forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    if (els.modelSearch) {
      els.modelSearch.addEventListener('input', (e) => {
        state.modelSearch = e.target.value || '';
        renderModelOptions();
      });
    }

    if (els.modelList) {
      els.modelList.addEventListener('click', (e) => {
        const option = e.target.closest('.model-option');
        if (!option) return;

        const value = option.dataset.value;
        if (value === '__all') {
          state.selectedModels.clear();
        } else if (option.querySelector('input[type="checkbox"]')) {
          if (state.selectedModels.has(value)) {
            state.selectedModels.delete(value);
          } else {
            state.selectedModels.add(value);
          }
        }

        renderModelOptions();
      });
    }

    if (els.applyFilters) {
      els.applyFilters.addEventListener('click', () => {
        state.priceMin = els.priceMin?.value || '';
        state.priceMax = els.priceMax?.value || '';
        applyFilters();
        closeFilterPanel();
      });
    }

    if (els.clearFilters) {
      els.clearFilters.addEventListener('click', () => {
        resetFilters();
        closeFilterPanel();
      });
    }

    if (els.refreshBtn) {
      els.refreshBtn.addEventListener('click', () => {
        loadCars(true);
      });
    }
  };

  const loadCars = async (forceRefresh = false) => {
    try {
      state.loading = true;
      setStatus('Đang tải dữ liệu...');
      const url = forceRefresh ? '/api/new-cars?refresh=true' : '/api/new-cars';
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      const data = Array.isArray(payload.data) ? payload.data : [];

      state.cars = data.map(enhanceCar);
      setUpdatedAt(payload.updatedAt || new Date().toISOString());
      renderBrandOptions();
      renderModelOptions();
      applyFilters();
      setStatus('Đã tải dữ liệu');
    } catch (error) {
      console.error('Không thể tải giá xe mới:', error);
      setStatus('Không thể tải dữ liệu. Vui lòng thử lại.');
      if (els.tableBody) {
        els.tableBody.innerHTML =
          '<tr><td colspan="6" class="empty">Không thể tải dữ liệu. Thử lại sau.</td></tr>';
      }
    } finally {
      state.loading = false;
    }
  };

  bindEvents();
  loadCars();
})();
