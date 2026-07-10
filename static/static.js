const StaticUI = (() => {
  let activeGroup = 'All';

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function nowIST() {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    }).format(new Date());
  }

  function setSyncTime() {
    const el = document.getElementById('sync-time');
    if (el) el.textContent = `Updated: ${nowIST()} (IST)`;
  }

  function renderKpis(machines) {
    const running = machines.filter((m) => m.status === 'running').length;
    const idle = machines.length - running;
    const el = document.getElementById('kpi-strip');
    if (!el) return;
    el.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-icon blue">🏭</div>
        <div><div class="kpi-value">${machines.length}</div><div class="kpi-label">Total Machines</div></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon green">▶</div>
        <div><div class="kpi-value">${running}</div><div class="kpi-label">Running</div></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon gray">⏸</div>
        <div><div class="kpi-value">${idle}</div><div class="kpi-label">Idle</div></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon orange">📋</div>
        <div><div class="kpi-value">SAP</div><div class="kpi-label">Data Source</div></div>
      </div>
    `;
  }

  function renderChips(groups) {
    const el = document.getElementById('group-chips');
    if (!el) return;
    el.innerHTML = ['All', ...groups]
      .map(
        (g) =>
          `<button type="button" class="chip${g === activeGroup ? ' active' : ''}" data-group="${esc(g)}">${esc(g)}</button>`,
      )
      .join('');
    el.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        activeGroup = chip.dataset.group;
        renderChips(groups);
        renderGrid(getFiltered());
      });
    });
  }

  function getFiltered() {
    const q = (document.getElementById('search')?.value || '').toLowerCase();
    return MOCK_MACHINES.filter((m) => {
      const matchGroup = activeGroup === 'All' || m.group === activeGroup;
      const matchSearch = !q || m.name.toLowerCase().includes(q) || m.id.includes(q);
      return matchGroup && matchSearch;
    });
  }

  function renderCard(m) {
    const isRunning = m.status === 'running';
    let body;
    if (isRunning) {
      body = `
        <div class="info-row"><span class="lbl">FG Code</span><span class="val">${esc(m.fgCode)}</span></div>
        <div class="info-row"><span class="lbl">Operator</span><span class="val">${esc(m.operator)}</span></div>
        <div class="info-row"><span class="lbl">Started</span><span class="val">${esc(m.startTime)}</span></div>
      `;
    } else {
      body = `
        <p class="idle-msg">No job running</p>
        <div class="info-row"><span class="lbl">Last completed</span><span class="val">${esc(m.lastCompleted || '—')}</span></div>
      `;
    }

    return `
      <article class="m-card ${isRunning ? 'running' : ''}" data-id="${esc(m.id)}">
        <div class="m-card-photo-wrap">
          <img class="m-card-photo" src="${esc(m.image)}" alt="${esc(m.name)}" loading="lazy">
          <span class="status-pill ${isRunning ? 'running' : 'idle'}">
            <span class="dot"></span>${isRunning ? 'Running' : 'Idle'}
          </span>
        </div>
        <div class="m-card-inner">
          <div class="m-card-header">
            <div>
              <div class="m-card-title">${esc(m.name)}</div>
              <div class="m-card-group">${esc(m.group)}</div>
            </div>
          </div>
          <div class="m-card-body">${body}</div>
          <div class="m-card-footer">
            <button type="button" class="btn btn-primary btn-sm btn-open" data-id="${esc(m.id)}">Open</button>
            <button type="button" class="btn btn-ghost btn-sm">Fetch</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderGrid(list) {
    const grid = document.getElementById('machine-grid');
    if (!grid) return;
    grid.innerHTML = list.map(renderCard).join('');
    grid.querySelectorAll('.btn-open').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.href = `machine.html?id=${btn.dataset.id}`;
      });
    });
    grid.querySelectorAll('.m-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        window.location.href = `machine.html?id=${card.dataset.id}`;
      });
    });
  }

  function initHome() {
    setSyncTime();
    const groups = [...new Set(MOCK_MACHINES.map((m) => m.group))];
    renderKpis(MOCK_MACHINES);
    renderChips(groups);
    renderGrid(MOCK_MACHINES);
    document.getElementById('search')?.addEventListener('input', () => renderGrid(getFiltered()));
  }

  function initDetail() {
    setSyncTime();
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id') || 'lam-yong-shun';
    const machine = MOCK_MACHINES.find((m) => m.id === id) || MOCK_MACHINES[0];

    document.getElementById('page-title').textContent = machine.name;
    document.getElementById('breadcrumb-name').textContent = machine.name;
    document.title = `${machine.name} — UI Preview`;

    const heroImg = document.getElementById('machine-hero-img');
    if (heroImg && machine.image) {
      heroImg.src = machine.image;
      heroImg.alt = machine.name;
      heroImg.classList.remove('hidden');
    }

    const hero = document.getElementById('running-hero');
    const heroTitle = document.getElementById('hero-title');
    const runningGrid = document.getElementById('running-grid');
    const elapsed = document.getElementById('elapsed');

    if (machine.status === 'running') {
      hero.classList.remove('idle-state');
      heroTitle.textContent = '▶ Currently Running';
      elapsed.classList.remove('hidden');
      runningGrid.innerHTML = `
        <div class="detail-item"><div class="lbl">Job No</div><div class="val">1000957</div></div>
        <div class="detail-item"><div class="lbl">FG Code</div><div class="val">${esc(machine.fgCode)}</div></div>
        <div class="detail-item"><div class="lbl">Operator</div><div class="val">${esc(machine.operator)}</div></div>
        <div class="detail-item"><div class="lbl">Start Time</div><div class="val">${esc(machine.startTime)}</div></div>
        <div class="detail-item"><div class="lbl">Batch</div><div class="val">B010963</div></div>
      `;
    } else {
      hero.classList.add('idle-state');
      heroTitle.textContent = '⏸ No job currently running on this machine';
      elapsed.classList.add('hidden');
      runningGrid.innerHTML = '';
    }

    const tbody = document.getElementById('jobs-tbody');
    const rowCount = document.getElementById('row-count');
    tbody.innerHTML = MOCK_COMPLETED_JOBS.map(
      (j, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(j.start)}</td>
        <td>${esc(j.end)}</td>
        <td>${esc(j.duration)}</td>
        <td>${esc(j.operator)}</td>
        <td>${esc(j.jobNo)}</td>
        <td>${esc(j.fgCode)}</td>
        <td>${esc(j.description)}</td>
        <td>${esc(j.batchNo)}</td>
        <td>${esc(j.qty)}</td>
      </tr>
    `,
    ).join('');
    if (rowCount) rowCount.textContent = `${MOCK_COMPLETED_JOBS.length} rows`;

    document.getElementById('btn-apply')?.addEventListener('click', () => {
      alert('Static preview — filter will work on live app');
    });
  }

  return { initHome, initDetail };
})();
