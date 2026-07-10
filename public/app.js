const DashboardApp = (() => {
  let refreshTimer = null;
  let elapsedTimer = null;
  let refreshMs = 30000;
  let machineCatalog = [];
  let departments = [];
  let imageMap = new Map();
  let deptMap = new Map();
  let lastMachines = [];
  let lastDeptMachines = [];
  let activeDeptId = null;

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function todayYmd() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  }

  function addDaysYmd(ymd, days) {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  }

  function getDefaultDateRange() {
    const to = todayYmd();
    return { from: addDaysYmd(to, -7), to };
  }

  function buildDateQuery(from, to) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  function getQueryDateRange() {
    const params = new URLSearchParams(window.location.search);
    const defaults = getDefaultDateRange();
    return { from: params.get('from') || defaults.from, to: params.get('to') || defaults.to };
  }

  function formatLastUpdated(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      }).format(d);
    } catch {
      return String(iso);
    }
  }

  function formatElapsed(startTimeISO) {
    if (!startTimeISO) return '—';
    const start = new Date(startTimeISO);
    if (Number.isNaN(start.getTime())) return '—';
    const diffMs = Date.now() - start.getTime();
    if (diffMs < 0) return '0m';
    const totalMin = Math.floor(diffMs / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function getImage(id) {
    return imageMap.get(id) || '/images/machines/placeholder.svg';
  }

  function getDeptName(id) {
    return deptMap.get(id)?.name || 'Other';
  }

  function showSapBanner(data) {
    const banner = document.getElementById('status-banner');
    if (!banner) return;
    if (data.jobHistorySource === 'database') {
      if (data.databaseAvailable === false) {
        banner.textContent = data.databaseError ? `DB: ${data.databaseError}` : 'Database unavailable';
        banner.className = 'status-banner error';
        banner.classList.remove('hidden');
      } else if (data.stale) {
        banner.textContent = 'Cached data — database refresh failed';
        banner.className = 'status-banner warning';
        banner.classList.remove('hidden');
      } else {
        banner.classList.add('hidden');
      }
      return;
    }
    if (!data.sapAvailable) {
      banner.textContent = data.sapError ? `SAP: ${data.sapError}` : 'SAP unavailable';
      banner.className = 'status-banner error';
      banner.classList.remove('hidden');
    } else if (data.stale) {
      banner.textContent = 'Cached data — SAP refresh failed';
      banner.className = 'status-banner warning';
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  function updateLastUpdated(iso) {
    const el = document.getElementById('last-updated');
    if (el) el.textContent = `Updated: ${formatLastUpdated(iso)} (IST)`;
  }

  function scheduleRefresh(fn) {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(fn, refreshMs);
  }

  function ensureStatusPopover() {
    if (document.getElementById('status-popover')) return;
    const el = document.createElement('div');
    el.id = 'status-popover';
    el.className = 'status-popover hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Connection status');
    el.innerHTML = `
      <div class="status-popover-head">
        <strong>Connection Status</strong>
        <button type="button" id="status-popover-close" class="status-popover-close" aria-label="Close">×</button>
      </div>
      <div id="status-popover-body" class="status-popover-body">Checking…</div>
    `;
    document.body.appendChild(el);
    document.getElementById('status-popover-close')?.addEventListener('click', hideStatusPopover);
    document.addEventListener('click', (e) => {
      const pop = document.getElementById('status-popover');
      const btn = document.getElementById('btn-status');
      if (!pop || pop.classList.contains('hidden')) return;
      if (pop.contains(e.target) || btn?.contains(e.target)) return;
      hideStatusPopover();
    });
  }

  function hideStatusPopover() {
    document.getElementById('status-popover')?.classList.add('hidden');
  }

  function renderStatusBody(data) {
    const row = (label, item) => `
      <div class="status-row">
        <div>
          <div class="status-row-label">${esc(label)}</div>
          <div class="status-row-msg">${esc(item?.message || '—')}</div>
        </div>
        <span class="status-badge ${item?.ok ? 'ok' : 'fail'}">${item?.ok ? '● Connected' : '● Failed'}</span>
      </div>
    `;
    return `${row('SAP', data.sap)}${row('Database', data.database)}<div class="status-checked-at">Checked: ${esc(formatLastUpdated(data.checkedAt))}</div>`;
  }

  async function showConnectionStatus() {
    ensureStatusPopover();
    const pop = document.getElementById('status-popover');
    const body = document.getElementById('status-popover-body');
    if (!pop || !body) return;
    pop.classList.remove('hidden');
    body.innerHTML = '<div class="status-row"><div class="status-row-label">Checking…</div><span class="status-badge wait">…</span></div>';
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      body.innerHTML = renderStatusBody(data);
    } catch (err) {
      body.innerHTML = `<p class="error-inline">Status check failed: ${esc(err.message)}</p>`;
    }
  }

  function bindStatusButton() {
    ensureStatusPopover();
    const btn = document.getElementById('btn-status');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = document.getElementById('status-popover');
      if (pop && !pop.classList.contains('hidden')) hideStatusPopover();
      else showConnectionStatus();
    });
  }

  function isActiveMachine(m) {
    const s = m.live?.status || m.status;
    return s === 'running' || s === 'makeready';
  }

  function getDeptStats(dept) {
    const ids = new Set(dept.machines.map((m) => m.id));
    const machines = lastMachines.filter((m) => ids.has(m.id));
    const running = machines.filter(isActiveMachine).length;
    return { total: dept.machines.length, running, loaded: machines.length };
  }

  function renderDeptStatus(dept) {
    const stats = getDeptStats(dept);
    if (!stats.total) return 'No machines configured';
    if (!lastMachines.length) return 'Loading…';
    if (stats.running > 0) {
      return `<span class="running-count">${stats.running} running</span> · ${stats.total} machine${stats.total > 1 ? 's' : ''}`;
    }
    return `${stats.total} machine${stats.total > 1 ? 's' : ''} · All idle`;
  }

  function renderDeptCard(dept) {
    const disabled = !dept.machineCount;
    return `
      <article class="dept-card${disabled ? ' disabled' : ''}" data-id="${esc(dept.id)}" style="--dept-color: ${esc(dept.color)}">
        <div class="dept-card-top">
          <div class="dept-icon">${dept.icon || '🏭'}</div>
          <div class="dept-arrow">→</div>
        </div>
        <div class="dept-name">${esc(dept.name)}</div>
        <div class="dept-status" id="dept-status-${esc(dept.id)}">${renderDeptStatus(dept)}</div>
        <div class="dept-machine-count">${dept.machineCount || 0} Machine${(dept.machineCount || 0) !== 1 ? 's' : ''}</div>
        <div class="dept-glow"></div>
      </article>
    `;
  }

  function getDeptLiveMachines(dept) {
    const liveById = new Map(lastMachines.map((m) => [m.id, m]));
    return dept.machines.map((m) => {
      const row = liveById.get(m.id);
      return {
        id: m.id,
        name: m.name,
        image: m.image || getImage(m.id),
        status: row?.status || 'idle',
        live: row?.live || {
          status: 'idle',
          stateLabel: lastMachines.length ? 'Idle' : 'Loading…',
        },
      };
    });
  }

  function filterHomeMachines(machine) {
    const q = (document.getElementById('search')?.value || '').toLowerCase();
    if (!q) return true;
    return machine.name.toLowerCase().includes(q) || machine.id.toLowerCase().includes(q);
  }

  function renderHomeDeptSection(dept, machines) {
    return `
      <section class="home-dept-section" style="--dept-color: ${esc(dept.color)}">
        <div class="home-dept-head">
          <div class="home-dept-title-wrap">
            <span class="home-dept-icon">${dept.icon || '🏭'}</span>
            <div>
              <h2 class="home-dept-title">${esc(dept.name)}</h2>
              <p class="home-dept-status">${renderDeptStatus(dept)}</p>
            </div>
          </div>
          <a class="home-dept-link" href="/department/${esc(dept.id)}">View department →</a>
        </div>
        <div class="shift-grid">
          ${machines.map((m) => renderShiftCard(m)).join('')}
        </div>
      </section>
    `;
  }

  function renderHomeGrouped() {
    const root = document.getElementById('home-departments');
    if (!root) return;

    const sections = departments
      .map((dept) => {
        if (!dept.machineCount) return '';
        const machines = getDeptLiveMachines(dept).filter(filterHomeMachines);
        if (!machines.length) return '';
        return renderHomeDeptSection(dept, machines);
      })
      .filter(Boolean);

    root.innerHTML = sections.length
      ? sections.join('')
      : '<p class="empty-message">No machines match your search.</p>';
    bindShiftCardActions();
  }

  function renderDeptGrid() {
    const grid = document.getElementById('dept-grid');
    if (!grid) return;
    grid.innerHTML = departments.map((d) => renderDeptCard(d)).join('');
    grid.querySelectorAll('.dept-card:not(.disabled)').forEach((card) => {
      card.addEventListener('click', () => {
        window.location.href = `/department/${card.dataset.id}`;
      });
    });
  }

  function updateDeptStatuses() {
    departments.forEach((dept) => {
      const el = document.getElementById(`dept-status-${dept.id}`);
      if (el) el.innerHTML = renderDeptStatus(dept);
    });
  }

  function showDbBanner(available, message) {
    const banner = document.getElementById('status-banner');
    if (!banner) return;
    if (!available) {
      banner.textContent = message ? `DB: ${message}` : 'Database unavailable';
      banner.className = 'status-banner warning';
      banner.classList.remove('hidden');
    } else if (banner.classList.contains('warning') && banner.textContent.startsWith('DB:')) {
      banner.classList.add('hidden');
    }
  }

  function shiftMeta(label, value) {
    return `<div class="shift-meta-box"><div class="lbl">${esc(label)}</div><div class="val">${esc(value || '—')}</div></div>`;
  }

  function renderShiftCard(m) {
    const live = m.live || {};
    const statusClass = live.status || 'idle';
    const img = m.image || getImage(m.id);
    const showOperator = !!live.hasActiveJob;
    const jobText = live.runningJob
      ? (live.jobName ? `${live.runningJob} — ${live.jobName}` : live.runningJob)
      : '—';
    const mrDisplay = live.expectedMr || '—';
    const runDisplay = live.expectedRunning || '—';

    return `
      <article class="shift-card" data-id="${esc(m.id)}" id="shift-${esc(m.id)}">
        <div class="shift-card-head">
          <div class="shift-card-title">${esc(m.name)}</div>
          <span class="shift-status-pill ${esc(statusClass)}">${esc(live.stateLabel || 'Idle')}</span>
        </div>
        ${showOperator ? `
        <div class="shift-meta-row">
          ${shiftMeta('👤 Operator', live.operator)}
          ${shiftMeta('🕐 Login Time', live.loginTime)}
        </div>` : ''}
        <img class="shift-card-photo" src="${esc(img)}" alt="${esc(m.name)}" loading="lazy">
        <div class="shift-job-row">
          ${shiftMeta('Production No', jobText)}
          ${shiftMeta('Job No', live.sapJobNo || '—')}
          ${shiftMeta('Planned Qty', live.plannedQty != null ? String(live.plannedQty) : '—')}
        </div>
        <div class="shift-time-grid">
          ${shiftMeta('🕐 Start Time', live.startTime)}
          ${shiftMeta('🕐 Expected M/R Time', mrDisplay)}
          ${shiftMeta('🕐 Expected Running Time', runDisplay)}
          ${shiftMeta('🕐 Expected End Time', live.expectedEnd)}
          ${shiftMeta('🕐 Time Remaining', live.timeRemaining)}
        </div>
        ${live.lastEventAt ? `<div class="shift-card-footnote">Last update: ${esc(live.lastEventAt)}</div>` : ''}
        <div class="shift-card-actions">
          <button type="button" class="shift-btn btn-shift-detail" data-id="${esc(m.id)}">Job History</button>
        </div>
      </article>
    `;
  }

  function bindShiftCardActions() {
    document.querySelectorAll('.btn-shift-detail').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        window.location.href = `/machine/${btn.dataset.id}`;
      };
    });
  }

  function renderShiftGrid(list) {
    const grid = document.getElementById('machine-grid');
    if (!grid) return;
    grid.innerHTML = list.map((m) => renderShiftCard(m)).join('');
    bindShiftCardActions();
  }

  function filterDeptLiveMachines(machines) {
    const q = (document.getElementById('search')?.value || '').toLowerCase();
    return machines.filter((m) => {
      const matchSearch = !q || m.name.toLowerCase().includes(q) || m.id.includes(q);
      return matchSearch;
    });
  }

  function renderDeptKpisFromLive(dept, machines) {
    const el = document.getElementById('dept-kpi');
    if (!el || !dept) return;
    const active = machines.filter((m) => {
      const s = m.live?.status;
      return s === 'running' || s === 'makeready';
    }).length;
    const online = machines.filter((m) => m.live?.isOnline).length;
    el.style.setProperty('--dept-color', dept.color);
    el.innerHTML = `
      <div class="kpi-card"><div class="kpi-icon blue">🏭</div><div><div class="kpi-value">${machines.length}</div><div class="kpi-label">Machines</div></div></div>
      <div class="kpi-card"><div class="kpi-icon green">▶</div><div><div class="kpi-value">${active}</div><div class="kpi-label">Active</div></div></div>
      <div class="kpi-card"><div class="kpi-icon orange">📡</div><div><div class="kpi-value">${online}</div><div class="kpi-label">Online</div></div></div>
    `;
  }

  async function fetchDepartmentLive() {
    const loading = document.getElementById('loading');
    const errorState = document.getElementById('error-state');
    if (!activeDeptId) return;
    try {
      if (loading) loading.classList.remove('hidden');
      const res = await fetch(`/api/departments/${activeDeptId}/live`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.refreshMs) refreshMs = data.refreshMs;
      lastDeptMachines = data.machines || [];
      const dept = departments.find((d) => d.id === activeDeptId);
      if (loading) loading.classList.add('hidden');
      if (errorState) errorState.classList.add('hidden');
      updateLastUpdated(data.generatedAt);
      showDbBanner(data.databaseAvailable, data.databaseError);
      renderDeptKpisFromLive(dept, lastDeptMachines);
      renderShiftGrid(filterDeptLiveMachines(lastDeptMachines));
    } catch (err) {
      if (loading) loading.classList.add('hidden');
      if (errorState) {
        errorState.classList.remove('hidden');
        errorState.textContent = `Failed to load live status: ${err.message}`;
      }
    }
  }

  function renderCardBody(m) {
    const isRunning = m.status === 'running';
    const job = m.currentJob;
    if (isRunning && job) {
      return `
        <div class="info-row"><span class="lbl">FG Code</span><span class="val">${esc(job.fgCode || '—')}</span></div>
        <div class="info-row"><span class="lbl">Operator</span><span class="val">${esc(job.operator || '—')}</span></div>
        <div class="info-row"><span class="lbl">Started</span><span class="val">${esc(job.startTime || '—')}</span></div>
      `;
    }
    const last = m.lastCompletedAt ? formatLastUpdated(m.lastCompletedAt) : '—';
    return `<p class="idle-msg">No job running</p><div class="info-row"><span class="lbl">Last completed</span><span class="val">${esc(last)}</span></div>`;
  }

  function renderCard(m, { loading = false } = {}) {
    const isRunning = !loading && m.status === 'running';
    const statusClass = loading ? 'loading' : isRunning ? 'running' : 'idle';
    const statusLabel = loading ? 'Loading…' : isRunning ? 'Running' : 'Idle';
    const img = getImage(m.id);
    const deptName = getDeptName(m.id);

    return `
      <article class="m-card ${isRunning ? 'running' : ''}${loading ? ' is-loading' : ''}" data-id="${esc(m.id)}" id="card-${esc(m.id)}">
        <div class="m-card-photo-wrap">
          <img class="m-card-photo" src="${esc(img)}" alt="${esc(m.name)}" loading="lazy">
          <span class="status-pill ${statusClass}" id="badge-${esc(m.id)}"><span class="dot"></span>${statusLabel}</span>
        </div>
        <div class="m-card-inner">
          <div><div class="m-card-title">${esc(m.name)}</div><div class="m-card-group">${esc(deptName)}</div></div>
          <div class="m-card-body" id="body-${esc(m.id)}">${loading ? '<p class="idle-msg">Waiting for SAP…</p>' : renderCardBody(m)}</div>
          <div class="m-card-footer">
            <button type="button" class="btn btn-primary btn-sm btn-open" data-id="${esc(m.id)}">Open</button>
            <button type="button" class="btn btn-ghost btn-sm btn-fetch" data-id="${esc(m.id)}">Fetch</button>
          </div>
        </div>
      </article>
    `;
  }

  function bindCardActions() {
    document.querySelectorAll('.btn-fetch').forEach((btn) => {
      btn.onclick = (e) => { e.stopPropagation(); fetchSingleMachine(btn.dataset.id, btn); };
    });
    document.querySelectorAll('.btn-open').forEach((btn) => {
      btn.onclick = (e) => { e.stopPropagation(); window.location.href = `/machine/${btn.dataset.id}`; };
    });
    document.querySelectorAll('.m-card').forEach((card) => {
      card.onclick = (e) => {
        if (e.target.closest('button')) return;
        window.location.href = `/machine/${card.dataset.id}`;
      };
    });
  }

  function getDeptMachineIds(deptId) {
    const dept = departments.find((d) => d.id === deptId);
    return dept ? dept.machines.map((m) => m.id) : [];
  }

  function filterDeptMachines(machines) {
    const ids = new Set(getDeptMachineIds(activeDeptId));
    const q = (document.getElementById('search')?.value || '').toLowerCase();
    return machines.filter((m) => {
      const inDept = ids.has(m.id);
      const matchSearch = !q || m.name.toLowerCase().includes(q) || m.id.includes(q);
      return inDept && matchSearch;
    });
  }

  function renderGrid(list) {
    const grid = document.getElementById('machine-grid');
    if (!grid) return;
    grid.innerHTML = list.map((m) => renderCard(m)).join('');
    bindCardActions();
  }

  function updateCard(m) {
    const card = document.getElementById(`card-${m.id}`);
    const badge = document.getElementById(`badge-${m.id}`);
    const body = document.getElementById(`body-${m.id}`);
    if (!card || !badge || !body) return;
    const isRunning = m.status === 'running';
    card.classList.remove('is-loading');
    card.classList.toggle('running', isRunning);
    badge.className = `status-pill ${isRunning ? 'running' : 'idle'}`;
    badge.innerHTML = `<span class="dot"></span>${isRunning ? 'Running' : 'Idle'}`;
    body.innerHTML = renderCardBody(m);
  }

  function renderDeptKpis(dept, machines) {
    const el = document.getElementById('dept-kpi');
    if (!el || !dept) return;
    const running = machines.filter((m) => m.status === 'running').length;
    el.style.setProperty('--dept-color', dept.color);
    el.innerHTML = `
      <div class="kpi-card"><div class="kpi-icon blue">🏭</div><div><div class="kpi-value">${machines.length}</div><div class="kpi-label">Machines</div></div></div>
      <div class="kpi-card"><div class="kpi-icon green">▶</div><div><div class="kpi-value">${running}</div><div class="kpi-label">Running</div></div></div>
      <div class="kpi-card"><div class="kpi-icon gray">⏸</div><div><div class="kpi-value">${machines.length - running}</div><div class="kpi-label">Idle</div></div></div>
    `;
  }

  async function loadDepartments() {
    const res = await fetch('/api/departments');
    if (!res.ok) throw new Error('Could not load departments');
    const data = await res.json();
    departments = data.departments || [];
    departments.forEach((d) => {
      d.machines.forEach((m) => deptMap.set(m.id, d));
    });
    return departments;
  }

  async function loadMachineCatalog() {
    const res = await fetch('/api/machines/list');
    if (!res.ok) throw new Error('Could not load machine list');
    const data = await res.json();
    machineCatalog = data.machines || [];
    imageMap = new Map(machineCatalog.map((m) => [m.id, m.image || '/images/machines/placeholder.svg']));
    machineCatalog.forEach((m) => {
      if (m.department) deptMap.set(m.id, m.department);
    });
    return machineCatalog;
  }

  async function fetchSingleMachine(machineId, btn) {
    const card = document.getElementById(`card-${machineId}`);
    if (btn) { btn.disabled = true; btn.textContent = 'Fetching…'; }
    if (card) card.classList.add('is-loading');
    try {
      const res = await fetch(`/api/machines/${machineId}/refresh`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const summary = data.summary || {
        id: machineId,
        name: data.machine?.name || machineId,
        status: data.currentJob ? 'running' : 'idle',
        currentJob: data.currentJob,
        lastCompletedAt: data.completedJobs?.[0]?.endTimeISO || null,
      };
      const idx = lastMachines.findIndex((m) => m.id === machineId);
      if (idx >= 0) lastMachines[idx] = { ...lastMachines[idx], ...summary };
      else lastMachines.push(summary);
      updateCard(summary);
      if (data.generatedAt) updateLastUpdated(data.generatedAt);
      showSapBanner(data);
      updateDeptStatuses();
      const dept = departments.find((d) => d.id === activeDeptId);
      if (dept) renderDeptKpis(dept, filterDeptMachines(lastMachines));
    } catch (err) {
      const body = document.getElementById(`body-${machineId}`);
      if (body) body.innerHTML = `<p class="error-inline">Fetch failed: ${esc(err.message)}</p>`;
    } finally {
      if (card) card.classList.remove('is-loading');
      if (btn) { btn.disabled = false; btn.textContent = 'Fetch'; }
    }
  }

  async function fetchHomeLive() {
    const loading = document.getElementById('loading');
    const errorState = document.getElementById('error-state');
    try {
      if (loading) loading.classList.remove('hidden');
      const res = await fetch('/api/machines/live');
      const data = await res.json();
      if (!res.ok) throw new Error(data.databaseError || data.error || `HTTP ${res.status}`);
      if (data.refreshMs) refreshMs = data.refreshMs;
      lastMachines = data.machines || [];
      if (loading) loading.classList.add('hidden');
      if (errorState) errorState.classList.add('hidden');
      updateLastUpdated(data.generatedAt);
      showDbBanner(data.databaseAvailable !== false, data.databaseError);
      renderHomeGrouped();
    } catch (err) {
      if (loading) loading.classList.add('hidden');
      if (errorState) {
        errorState.classList.remove('hidden');
        errorState.textContent = `Failed to load: ${err.message}`;
      }
    }
  }

  async function fetchMachines(forceRefresh = false) {
    const loading = document.getElementById('loading');
    const errorState = document.getElementById('error-state');
    try {
      if (loading) loading.classList.remove('hidden');
      const url = forceRefresh ? '/api/machines?refresh=1' : '/api/machines';
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok && !data.machines) throw new Error(data.sapError || data.error || `HTTP ${res.status}`);
      if (data.refreshMs) refreshMs = data.refreshMs;
      lastMachines = data.machines || [];
      if (loading) loading.classList.add('hidden');
      if (errorState) errorState.classList.add('hidden');
      updateLastUpdated(data.generatedAt);
      showSapBanner(data);
      updateDeptStatuses();
      if (activeDeptId) {
        const dept = departments.find((d) => d.id === activeDeptId);
        const filtered = filterDeptMachines(lastMachines);
        renderDeptKpis(dept, filtered);
        renderGrid(filtered.length ? filtered : getDeptMachineIds(activeDeptId).map((id) => {
          const m = machineCatalog.find((x) => x.id === id);
          return { id, name: m?.name || id, status: 'idle' };
        }));
        if (filtered.length) filtered.forEach(updateCard);
      }
    } catch (err) {
      if (loading) loading.classList.add('hidden');
      if (errorState) {
        errorState.classList.remove('hidden');
        errorState.textContent = `Failed to load: ${err.message}. Use Fetch on each card.`;
      }
    }
  }

  async function initHome() {
    bindStatusButton();
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.textContent = 'Loading live status from database…';
    document.getElementById('btn-refresh')?.addEventListener('click', () => fetchHomeLive());
    document.getElementById('search')?.addEventListener('input', () => renderHomeGrouped());
    try {
      await loadDepartments();
      await loadMachineCatalog();
      renderHomeGrouped();
      updateLastUpdated(new Date().toISOString());
    } catch (err) {
      const errorState = document.getElementById('error-state');
      if (errorState) { errorState.classList.remove('hidden'); errorState.textContent = err.message; }
    }
    fetchHomeLive();
    scheduleRefresh(() => fetchHomeLive());
  }

  function getDeptIdFromPath() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('department');
    return idx >= 0 ? parts[idx + 1] : null;
  }

  function getMachineIdFromPath() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('machine');
    return idx >= 0 ? parts[idx + 1] : null;
  }

  async function initDepartment() {
    bindStatusButton();
    activeDeptId = getDeptIdFromPath();
    if (!activeDeptId) { window.location.href = '/'; return; }

    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.textContent = 'Loading live status from database…';

    try {
      await loadDepartments();
      await loadMachineCatalog();
    } catch (err) {
      const errorState = document.getElementById('error-state');
      if (errorState) { errorState.classList.remove('hidden'); errorState.textContent = err.message; }
      return;
    }

    const dept = departments.find((d) => d.id === activeDeptId);
    if (!dept) { window.location.href = '/'; return; }

    document.title = `${dept.name} — VK Global Digital`;
    document.getElementById('dept-title').textContent = dept.name;
    document.getElementById('dept-subtitle').textContent = 'Shift summary · live from machine_status';
    document.getElementById('breadcrumb-dept').textContent = dept.name;
    document.documentElement.style.setProperty('--dept-color', dept.color);

    const skeleton = dept.machines.map((m) => ({
      id: m.id,
      name: m.name,
      image: m.image || getImage(m.id),
      live: { status: 'idle', stateLabel: 'Loading…' },
    }));
    renderDeptKpisFromLive(dept, skeleton);
    renderShiftGrid(skeleton);

    document.getElementById('btn-refresh')?.addEventListener('click', () => fetchDepartmentLive());
    document.getElementById('search')?.addEventListener('input', () => {
      renderShiftGrid(filterDeptLiveMachines(lastDeptMachines.length ? lastDeptMachines : skeleton));
    });

    fetchDepartmentLive();
    scheduleRefresh(() => fetchDepartmentLive());
  }

  function getDetailDateRange() {
    const fromEl = document.getElementById('detail-from');
    const toEl = document.getElementById('detail-to');
    const urlRange = getQueryDateRange();
    return { from: fromEl?.value || urlRange.from, to: toEl?.value || urlRange.to };
  }

  function syncDetailDateInputs(range) {
    const fromEl = document.getElementById('detail-from');
    const toEl = document.getElementById('detail-to');
    if (fromEl) fromEl.value = range.from;
    if (toEl) toEl.value = range.to;
  }

  function updateFilterRangeLabel(dateRange) {
    const el = document.getElementById('filter-range-label');
    if (!el || !dateRange) return;
    const from = dateRange.startDate || dateRange.from;
    const to = dateRange.endDate || dateRange.to;
    if (from && to) el.textContent = `Showing completed jobs from ${from} to ${to}`;
  }

  function renderCompletedRows(jobs) {
    if (!jobs.length) return '';
    return jobs.map((job, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(job.startTime || '—')}</td>
        <td>${esc(job.endTime || '—')}</td>
        <td>${esc(job.duration || '—')}</td>
        <td>${esc(job.makeReady || '—')}</td>
        <td>${esc(job.operator || '—')}</td>
        <td>${esc(job.jobNo || '—')}</td>
        <td>${esc(job.fgCode || '—')}</td>
        <td>${esc(job.description || '—')}</td>
        <td>${esc(job.batchNo || '—')}</td>
        <td>${job.completedQty != null ? esc(String(job.completedQty)) : '—'}</td>
      </tr>
    `).join('');
  }

  function jobFromLive(live) {
    if (!live?.hasActiveJob) return null;
    return {
      jobNo: live.runningJob,
      sapJobNo: live.sapJobNo || null,
      fgCode: live.fgCode,
      description: live.jobName,
      operator: live.operator,
      startTime: live.startTime,
      startTimeISO: live.jobLoadedAtISO || live.stateStartedAtISO,
      batchNo: null,
      plannedQty: live.plannedQty,
      makereadyElapsed: live.makereadyElapsed,
      runningElapsed: live.runningElapsed,
      stateLabel: live.stateLabel,
      fromDatabase: true,
    };
  }

  function renderRunningPanel(job, live) {
    const hero = document.getElementById('current-job-panel');
    const idlePanel = document.getElementById('idle-panel');
    const heroTitle = document.getElementById('hero-title');
    const heroContent = document.getElementById('current-job-content');
    const elapsed = document.getElementById('elapsed-timer');

    if (!job) {
      hero?.classList.add('hidden');
      idlePanel?.classList.add('hidden');
      if (elapsedTimer) clearInterval(elapsedTimer);
      return;
    }

    hero?.classList.remove('hidden', 'idle-state');
    idlePanel?.classList.add('hidden');

    const jobLabel = job.jobNo || '—';
    const stateLabel = job.stateLabel || live?.stateLabel || 'Running';
    if (heroTitle) {
      heroTitle.textContent = job.fromDatabase
        ? `▶ ${stateLabel} — ${jobLabel}`
        : '▶ Currently Running';
    }

    if (elapsed && job.startTimeISO) {
      elapsed.classList.remove('hidden');
      const tick = () => { elapsed.textContent = `Elapsed: ${formatElapsed(job.startTimeISO)}`; };
      tick();
      if (elapsedTimer) clearInterval(elapsedTimer);
      elapsedTimer = setInterval(tick, 30000);
    } else if (elapsed) {
      elapsed.classList.add('hidden');
      if (elapsedTimer) clearInterval(elapsedTimer);
    }

    if (job.fromDatabase) {
      heroContent.innerHTML = `
        <div class="detail-item"><div class="lbl">Status</div><div class="val">${esc(stateLabel)}</div></div>
        <div class="detail-item"><div class="lbl">Production No</div><div class="val">${esc(job.jobNo || '—')}</div></div>
        <div class="detail-item"><div class="lbl">Job No</div><div class="val">${esc(job.sapJobNo || live?.sapJobNo || '—')}</div></div>
        <div class="detail-item"><div class="lbl">FG Code</div><div class="val">${esc(job.fgCode || '—')}</div></div>
        <div class="detail-item"><div class="lbl">Description</div><div class="val">${esc(job.description || '—')}</div></div>
        <div class="detail-item"><div class="lbl">Operator</div><div class="val">${esc(job.operator || '—')}</div></div>
        <div class="detail-item"><div class="lbl">Planned Qty</div><div class="val">${job.plannedQty != null ? esc(String(job.plannedQty)) : '—'}</div></div>
        <div class="detail-item"><div class="lbl">Start Time</div><div class="val">${esc(job.startTime || '—')}</div></div>
        <div class="detail-item"><div class="lbl">M/R Elapsed</div><div class="val">${esc(job.makereadyElapsed || '—')}</div></div>
        <div class="detail-item"><div class="lbl">Running Elapsed</div><div class="val">${esc(job.runningElapsed || '—')}</div></div>
      `;
      return;
    }

    heroContent.innerHTML = `
      <div class="detail-item"><div class="lbl">Production No</div><div class="val">${esc(job.jobNo || '—')}</div></div>
      <div class="detail-item"><div class="lbl">FG Code</div><div class="val">${esc(job.fgCode || '—')}</div></div>
      <div class="detail-item"><div class="lbl">Description</div><div class="val">${esc(job.description || '—')}</div></div>
      <div class="detail-item"><div class="lbl">Operator</div><div class="val">${esc(job.operator || '—')}</div></div>
      <div class="detail-item"><div class="lbl">Batch</div><div class="val">${esc(job.batchNo || '—')}</div></div>
      <div class="detail-item"><div class="lbl">Start Time</div><div class="val">${esc(job.startTime || '—')}</div></div>
    `;
  }

  async function fetchMachineDetail(machineId, forceRefresh = false, dateRange) {
    const loading = document.getElementById('loading');
    const tbody = document.getElementById('completed-tbody');
    const noCompleted = document.getElementById('no-completed');
    const completedCount = document.getElementById('completed-count');
    const errorState = document.getElementById('error-state');
    const title = document.getElementById('machine-title');
    const breadcrumb = document.getElementById('breadcrumb-name');
    const breadcrumbDept = document.getElementById('breadcrumb-dept');
    const heroImg = document.getElementById('machine-hero-img');

    const range = dateRange || getDetailDateRange();

    try {
      const qs = buildDateQuery(range.from, range.to);
      const refreshPart = forceRefresh ? `${qs ? '&' : '?'}refresh=1` : '';
      const res = await fetch(`/api/machines/${machineId}${qs}${refreshPart}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.refreshMs) refreshMs = data.refreshMs;

      if (loading) loading.classList.add('hidden');
      if (errorState) errorState.classList.add('hidden');

      const name = data.machine?.name || machineId;
      if (title) title.textContent = name;
      if (breadcrumb) breadcrumb.textContent = name;
      document.title = `${name} — VK Global Digital`;

      const dept = deptMap.get(machineId);
      if (breadcrumbDept && dept) {
        breadcrumbDept.textContent = dept.name;
        breadcrumbDept.href = `/department/${dept.id}`;
      }

      if (heroImg) {
        heroImg.src = getImage(machineId);
        heroImg.alt = name;
        heroImg.classList.remove('hidden');
      }

      syncDetailDateInputs(range);
      updateFilterRangeLabel(data.dateRange || range);

      const live = data.live || null;
      const currentJob = data.currentJob || jobFromLive(live);
      renderRunningPanel(currentJob, live);

      const completed = data.completedJobs || [];
      tbody.innerHTML = renderCompletedRows(completed);
      noCompleted.classList.toggle('hidden', completed.length > 0);
      if (completedCount) completedCount.textContent = `${completed.length} rows`;

      updateLastUpdated(data.generatedAt);
      showSapBanner(data);
    } catch (err) {
      if (loading) loading.classList.add('hidden');
      if (errorState) {
        errorState.classList.remove('hidden');
        errorState.textContent = `Failed to load: ${err.message}`;
      }
    }
  }

  async function initMachineDetail() {
    const machineId = getMachineIdFromPath();
    if (!machineId) { window.location.href = '/'; return; }

    try {
      await loadDepartments();
      await loadMachineCatalog();
    } catch (_) { /* fallback */ }

    const urlRange = getQueryDateRange();
    syncDetailDateInputs(urlRange);

    document.getElementById('btn-refresh')?.addEventListener('click', () => fetchMachineDetail(machineId, true, getDetailDateRange()));
    bindStatusButton();
    document.getElementById('btn-apply-filter')?.addEventListener('click', () => {
      const range = getDetailDateRange();
      window.history.replaceState({}, '', `/machine/${machineId}${buildDateQuery(range.from, range.to)}`);
      fetchMachineDetail(machineId, true, range);
    });

    fetchMachineDetail(machineId, false, urlRange);
    scheduleRefresh(() => fetchMachineDetail(machineId, false, getDetailDateRange()));
  }

  return { initHome, initDepartment, initMachineDetail };
})();
