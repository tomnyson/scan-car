(() => {
  const els = {
    loanAmount: document.getElementById('loan-amount'),
    loanRate: document.getElementById('loan-rate'),
    loanTerm: document.getElementById('loan-term'),
    loanAmountDisplay: document.getElementById('loan-amount-display'),
    loanRateDisplay: document.getElementById('loan-rate-display'),
    loanTermDisplay: document.getElementById('loan-term-display'),
    loanFirstMonth: document.getElementById('loan-first-month'),
    loanTotalInterest: document.getElementById('loan-total-interest'),
    loanTotalPayment: document.getElementById('loan-total-payment'),
    loanMethods: document.querySelectorAll('input[name="loan-method"]'),
    loanChart: document.getElementById('loan-chart'),
    loanScheduleBody: document.getElementById('loan-schedule-body'),
    loanPagination: document.getElementById('loan-pagination'),
    mainNav: document.getElementById('main-nav'),
    mobileMenuToggle: document.getElementById('mobile-menu-toggle')
  };

  const state = {
    loan: {
      amount: 500_000_000,
      rate: 10,
      term: 84,
      method: 'declining',
      schedule: [],
      page: 1
    }
  };

  const getQueryNumber = (key) => {
    const params = new URLSearchParams(window.location.search || '');
    const raw = params.get(key);
    if (!raw) return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  };

  const presetPrice = getQueryNumber('price');
  if (presetPrice && presetPrice > 0) {
    state.loan.amount = Math.min(Math.max(presetPrice, 1_000_000), 20_000_000_000);
  }

  const applyStateToInputs = () => {
    if (els.loanAmount) {
      els.loanAmount.value = state.loan.amount;
    }
    if (els.loanRate) {
      els.loanRate.value = state.loan.rate;
    }
    if (els.loanTerm) {
      els.loanTerm.value = state.loan.term;
    }
    els.loanMethods.forEach((radio) => {
      radio.checked = radio.value === state.loan.method;
    });
  };

  const formatMoney = (value = 0) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value);
  const formatNumber = (value = 0) =>
    new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value);

  const computeLoan = () => {
    const amount = Math.max(0, state.loan.amount || 0);
    const term = Math.max(1, state.loan.term || 1);
    const monthlyRate = (Math.max(0, state.loan.rate || 0) / 100) / 12;
    const schedule = [];

    if (monthlyRate === 0) {
      const monthly = amount / term;
      for (let i = 0; i < term; i += 1) {
        const balance = amount - monthly * (i + 1);
        schedule.push({
          period: i + 1,
          interest: 0,
          principal: monthly,
          payment: monthly,
          balance: Math.max(0, balance)
        });
      }
      return {
        firstMonth: monthly,
        totalInterest: 0,
        totalPayment: amount,
        schedule
      };
    }

    if (state.loan.method === 'flat') {
      const emi = amount * monthlyRate / (1 - Math.pow(1 + monthlyRate, -term));
      const totalPayment = emi * term;
      let remaining = amount;
      for (let i = 0; i < term; i += 1) {
        const interest = remaining * monthlyRate;
        const principal = emi - interest;
        remaining -= principal;
        schedule.push({
          period: i + 1,
          interest,
          principal,
          payment: emi,
          balance: Math.max(0, remaining)
        });
      }
      return {
        firstMonth: emi,
        totalInterest: totalPayment - amount,
        totalPayment,
        schedule
      };
    }

    const monthlyPrincipal = amount / term;
    let remaining = amount;
    let totalInterest = 0;
    let firstMonth = 0;
    for (let i = 0; i < term; i += 1) {
      const interest = remaining * monthlyRate;
      if (i === 0) {
        firstMonth = monthlyPrincipal + interest;
      }
      totalInterest += interest;
      remaining -= monthlyPrincipal;
      schedule.push({
        period: i + 1,
        interest,
        principal: monthlyPrincipal,
        payment: monthlyPrincipal + interest,
        balance: Math.max(0, remaining)
      });
    }
    return {
      firstMonth,
      totalInterest,
      totalPayment: amount + totalInterest,
      schedule
    };
  };

  const buildLoanChartSvg = () => {
    const data = state.loan.schedule || [];
    if (!data.length) {
      return '<div class="empty">Chưa có dữ liệu</div>';
    }

    const width = 900;
    const height = 360;
    const padding = { top: 10, right: 16, bottom: 50, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const balances = data.map((d) => d.balance);
    const maxY = Math.max(...balances);
    const minY = Math.min(...balances);
    const yRange = maxY - minY || 1;

    const points = data.map((d, idx) => {
      const x = padding.left + (idx / Math.max(1, data.length - 1)) * chartWidth;
      const y = padding.top + chartHeight - ((d.balance - minY) / yRange) * chartHeight;
      return { x, y };
    });

    const polyline = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    const area = `${padding.left},${padding.top + chartHeight} ${polyline} ${padding.left + chartWidth},${padding.top + chartHeight}`;

    const circles = points
      .filter((_, idx) => idx % Math.ceil(points.length / 50) === 0 || idx === points.length - 1)
      .map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#c9971a" stroke="#b18316" stroke-width="1" />`)
      .join('');

    const xTicks = [];
    const xStep = Math.max(1, Math.ceil(data.length / 12));
    for (let i = 0; i < data.length; i += xStep) {
      xTicks.push({ idx: i, label: `Kỳ ${i + 1}` });
    }
    xTicks.push({ idx: data.length - 1, label: `Kỳ ${data.length}` });

    const xTickLines = xTicks
      .map((tick) => {
        const x = padding.left + (tick.idx / Math.max(1, data.length - 1)) * chartWidth;
        return `
          <line x1="${x}" y1="${padding.top}" x2="${x}" y2="${padding.top + chartHeight}" stroke="#e5e7eb" stroke-width="1" />
          <text x="${x}" y="${padding.top + chartHeight + 16}" font-size="11" fill="#4b5563" text-anchor="middle">${tick.label}</text>
        `;
      })
      .join('');

    const yTicks = [maxY, minY + yRange * 0.5, minY].map((val) => ({
      val,
      label: formatNumber(Math.round(val))
    }));

    const yTickLines = yTicks
      .map((tick) => {
        const y = padding.top + chartHeight - ((tick.val - minY) / yRange) * chartHeight;
        return `
          <line x1="${padding.left}" y1="${y}" x2="${padding.left + chartWidth}" y2="${y}" stroke="#f1f5f9" stroke-width="1" />
          <text x="${padding.left - 8}" y="${y + 4}" font-size="11" fill="#4b5563" text-anchor="end">${tick.label}</text>
        `;
      })
      .join('');

    return `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="loanArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#c9971a" stop-opacity="0.12"/>
            <stop offset="100%" stop-color="#c9971a" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        ${yTickLines}
        ${xTickLines}
        <polygon points="${area}" fill="url(#loanArea)" stroke="none"></polygon>
        <polyline points="${polyline}" fill="none" stroke="#c9971a" stroke-width="2.5" stroke-linecap="round"/>
        ${circles}
        <text x="${padding.left + chartWidth / 2}" y="${height - 10}" font-size="12" fill="#4b5563" text-anchor="middle">Kỳ trả nợ (tháng)</text>
        <text transform="translate(14 ${padding.top + chartHeight / 2}) rotate(-90)" font-size="12" fill="#4b5563" text-anchor="middle">Số tiền VND</text>
      </svg>
    `;
  };

  const renderLoanChart = () => {
    if (!els.loanChart) return;
    els.loanChart.innerHTML = buildLoanChartSvg();
  };

  const renderSchedule = () => {
    if (!els.loanScheduleBody) return;
    const data = state.loan.schedule || [];
    if (!data.length) {
      els.loanScheduleBody.innerHTML = '<tr><td colspan="5" class="empty">Chưa có dữ liệu</td></tr>';
      if (els.loanPagination) els.loanPagination.innerHTML = '';
      return;
    }

    const PAGE_SIZE = 12;
    const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
    state.loan.page = Math.min(state.loan.page, totalPages);
    const start = (state.loan.page - 1) * PAGE_SIZE;
    const pageItems = data.slice(start, start + PAGE_SIZE);

    els.loanScheduleBody.innerHTML = pageItems
      .map(
        (item) => `
        <tr>
          <td>${item.period}</td>
          <td>${formatNumber(Math.round(item.interest))}</td>
          <td>${formatNumber(Math.round(item.principal))}</td>
          <td>${formatNumber(Math.round(item.payment))}</td>
          <td>${formatNumber(Math.round(item.balance))}</td>
        </tr>
      `
      )
      .join('');

    if (els.loanPagination) {
      const buttons = [];
      for (let i = 1; i <= totalPages && i <= 10; i += 1) {
        buttons.push(
          `<button class="loan-page-btn ${i === state.loan.page ? 'active' : ''}" data-page="${i}">${i}</button>`
        );
      }
      els.loanPagination.innerHTML = buttons.join('');
      els.loanPagination.querySelectorAll('.loan-page-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const page = Number(btn.dataset.page);
          if (!isNaN(page)) {
            state.loan.page = page;
            renderSchedule();
          }
        });
      });
    }
  };

  const updateLoanUI = () => {
    const amount = state.loan.amount || 0;
    const rate = state.loan.rate || 0;
    const term = state.loan.term || 0;
    if (els.loanAmountDisplay) els.loanAmountDisplay.textContent = formatMoney(amount).replace('₫', '');
    if (els.loanRateDisplay) els.loanRateDisplay.textContent = rate.toFixed(1).replace(/\.0$/, '');
    if (els.loanTermDisplay) els.loanTermDisplay.textContent = term;

    const result = computeLoan();
    state.loan.schedule = result.schedule || [];
    state.loan.page = 1;
    if (els.loanFirstMonth) els.loanFirstMonth.textContent = formatMoney(result.firstMonth);
    if (els.loanTotalInterest) els.loanTotalInterest.textContent = formatMoney(result.totalInterest);
    if (els.loanTotalPayment) els.loanTotalPayment.textContent = formatMoney(result.totalPayment);
    renderLoanChart();
    renderSchedule();
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

    if (els.loanAmount) {
      els.loanAmount.addEventListener('input', (e) => {
        state.loan.amount = Number(e.target.value) || 0;
        updateLoanUI();
      });
    }
    if (els.loanRate) {
      els.loanRate.addEventListener('input', (e) => {
        state.loan.rate = Number(e.target.value) || 0;
        updateLoanUI();
      });
    }
    if (els.loanTerm) {
      els.loanTerm.addEventListener('input', (e) => {
        state.loan.term = Number(e.target.value) || 0;
        updateLoanUI();
      });
    }
    els.loanMethods.forEach((radio) => {
      radio.addEventListener('change', (e) => {
        if (e.target.checked) {
          state.loan.method = e.target.value;
          updateLoanUI();
        }
      });
    });
  };

  applyStateToInputs();
  bindEvents();
  updateLoanUI();
})();
