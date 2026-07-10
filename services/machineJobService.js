const mysql = require('mysql2/promise');
const { getDbConfig } = require('../config/db');
const { machines, getMachineById, getMachineNames } = require('../config/machines');
const sapService = require('./sapService');
const { fetchMakeReadyByJob } = require('./dbService');

const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE || 'Asia/Kolkata';
const CACHE_TTL_MS = Number(process.env.DASHBOARD_REFRESH_MS || 30000);
const COMPLETED_JOBS_LIMIT = Number(process.env.COMPLETED_JOBS_LIMIT || 0);
const BATCH_LOOKBACK_DAYS = Number(process.env.BATCH_LOOKBACK_DAYS || 7);

const cache = {
  all: { at: 0, data: null, error: null },
  machines: new Map(),
};
const inflight = new Map();

function formatDateYmd(date = new Date(), timeZone = REPORT_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

function addCalendarDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function isBatchEndEmpty(val) {
  if (val == null) return true;
  const s = String(val).trim();
  return s === '' || s === '-' || s === 'null';
}

function isBatchStartSet(val) {
  if (val == null) return false;
  return String(val).trim() !== '';
}

function parseSortKey(dt, admissionDate) {
  if (!dt) return '0000-00-00 00:00';
  const fullMatch = String(dt).match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
  if (fullMatch) return `${fullMatch[1]} ${fullMatch[2]}`;
  const timeOnly = String(dt).match(/^(\d{2}:\d{2})/);
  if (timeOnly) {
    const adm = admissionDate ? String(admissionDate).split('T')[0] : formatDateYmd();
    return `${adm} ${timeOnly[1]}`;
  }
  return '0000-00-00 00:00';
}

function parseSortKeyToDate(sortKey) {
  if (!sortKey || sortKey === '0000-00-00 00:00') return null;
  const [datePart, timePart] = sortKey.split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  // SAP batch times are wall-clock IST — use explicit offset for correct elapsed math
  return new Date(`${datePart}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`);
}

function formatDateTimeIST(dt, admissionDate) {
  if (!dt) return null;
  const sortKey = parseSortKey(dt, admissionDate);
  const parsed = parseSortKeyToDate(sortKey);
  if (!parsed) return String(dt);

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(parsed);
}

function formatDateTimeISO(dt, admissionDate) {
  if (!dt) return null;
  const sortKey = parseSortKey(dt, admissionDate);
  if (sortKey === '0000-00-00 00:00') return null;
  const [datePart, timePart] = sortKey.split(' ');
  return `${datePart}T${timePart}:00+05:30`;
}

function calculateDurationMinutes(startTime, endTime) {
  if (!startTime || !endTime || isBatchEndEmpty(endTime)) return null;

  let startDate = '2000-01-01';
  let endDate = '2000-01-01';
  let startHour;
  let startMin;
  let endHour;
  let endMin;

  const startFull = String(startTime).match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})/);
  const endFull = String(endTime).match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})/);
  const startOnly = String(startTime).match(/^(\d{2}):(\d{2})/);
  const endOnly = String(endTime).match(/^(\d{2}):(\d{2})/);

  if (startFull) {
    startDate = startFull[1];
    startHour = parseInt(startFull[2], 10);
    startMin = parseInt(startFull[3], 10);
  } else if (startOnly) {
    startHour = parseInt(startOnly[1], 10);
    startMin = parseInt(startOnly[2], 10);
  } else {
    return null;
  }

  if (endFull) {
    endDate = endFull[1];
    endHour = parseInt(endFull[2], 10);
    endMin = parseInt(endFull[3], 10);
  } else if (endOnly) {
    endHour = parseInt(endOnly[1], 10);
    endMin = parseInt(endOnly[2], 10);
  } else {
    return null;
  }

  const start = new Date(`${startDate}T${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00`);
  let end = new Date(`${endDate}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00`);

  if (end < start && !startFull && !endFull) {
    end.setDate(end.getDate() + 1);
  }

  const diffMs = end - start;
  if (diffMs < 0) return null;
  return Math.round(diffMs / 60000);
}

function formatDuration(minutes) {
  if (minutes == null || minutes < 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function enrichBatch(batch, enrichment) {
  const { batchToPOMap, batchQtyMap, prodOrderMap, jobMap } = enrichment;
  const batchNum = sapService.normalizeBatchNumber(batch);
  const itemCode = batch.ItemCode || '';
  const key = `${itemCode}_${batchNum}`;

  const poAbsoluteEntry = batchToPOMap.get(key);
  const po = poAbsoluteEntry ? prodOrderMap.get(poAbsoluteEntry) : null;
  const jobData = po?.U_JobEnt ? jobMap.get(parseInt(po.U_JobEnt, 10)) : null;
  const jobNo = jobData?.docNum != null ? String(jobData.docNum) : '';

  const completedRaw = batchQtyMap.get(key) || 0;
  const uPCode = (po?.U_PCode || '').toUpperCase().trim();
  const sheetBaseRatio = po?.sheetBaseRatio ?? null;

  let completedQty = completedRaw;
  let qtyLabel = 'qty';
  if ((uPCode === 'DIE' || uPCode === 'EMB+P') && sheetBaseRatio != null) {
    completedQty = Math.round(completedRaw * sheetBaseRatio);
    qtyLabel = 'sheets';
  }

  const admissionDate = batch.AdmissionDate ? String(batch.AdmissionDate).split('T')[0] : null;
  const startRaw = batch.U_BatchDt2 || '';
  const endRaw = batch.U_BatchDt3 || '';
  const durationMin = calculateDurationMinutes(startRaw, endRaw);

  return {
    jobNo,
    fgCode: itemCode,
    description: batch.ItemDescription || '',
    operator: batch.U_Operator || '',
    batchNo: batchNum,
    startTime: formatDateTimeIST(startRaw, admissionDate),
    endTime: formatDateTimeIST(endRaw, admissionDate),
    startTimeISO: formatDateTimeISO(startRaw, admissionDate),
    endTimeISO: formatDateTimeISO(endRaw, admissionDate),
    startSortKey: parseSortKey(startRaw, admissionDate),
    endSortKey: parseSortKey(endRaw, admissionDate),
    duration: formatDuration(durationMin),
    durationMinutes: durationMin,
    completedQty: completedQty > 0 ? completedQty : null,
    qtyLabel,
    productionOrderNo: po?.DocumentNumber || null,
    uPCode: uPCode || null,
    admissionDate,
  };
}

function attachMakeReady(jobs, makeReadyMap) {
  for (const job of jobs) {
    if (!job) continue;
    const keys = [job.jobNo, job.productionOrderNo].filter(Boolean).map((k) => String(k).trim());
    let seconds = null;
    for (const key of keys) {
      if (makeReadyMap.has(key)) {
        seconds = makeReadyMap.get(key);
        break;
      }
    }
    job.makeReadySeconds = seconds;
    job.makeReady = seconds != null ? formatDuration(Math.round(seconds / 60)) : '—';
  }
}

function classifyBatches(batches, enrichment, mysqlSupplement, makeReadyMap = new Map()) {
  const running = [];
  const completed = [];

  for (const batch of batches) {
    if (!isBatchStartSet(batch.U_BatchDt2)) continue;

    const job = enrichBatch(batch, enrichment);
    const batchNum = job.batchNo;
    const mysqlData = batchNum ? mysqlSupplement.get(batchNum) : null;
    if (mysqlData) {
      job.makereadyMinutes = mysqlData.makereadyMinutes;
      job.runningMinutes = mysqlData.runningMinutes;
      job.productionMinutes = mysqlData.productionMinutes;
    }

    if (isBatchEndEmpty(batch.U_BatchDt3)) {
      running.push(job);
    } else {
      completed.push(job);
    }
  }

  running.sort((a, b) => b.startSortKey.localeCompare(a.startSortKey));
  completed.sort((a, b) => b.endSortKey.localeCompare(a.endSortKey));

  attachMakeReady(running, makeReadyMap);
  attachMakeReady(completed, makeReadyMap);

  return {
    currentJob: running.length > 0 ? running[0] : null,
    completedJobs:
      COMPLETED_JOBS_LIMIT > 0 ? completed.slice(0, COMPLETED_JOBS_LIMIT) : completed,
    lastCompletedAt: completed.length > 0 ? completed[0].endTimeISO : null,
  };
}

async function fetchMysqlSupplement(machineId, startDate, endDate) {
  const supplement = new Map();
  const machineNames = getMachineNames(machineId);
  if (!machineNames.length) return supplement;

  let connection;
  try {
    connection = await mysql.createConnection(getDbConfig());
    const placeholders = machineNames.map(() => '?').join(', ');
    const query = `
      SELECT
        batch_num,
        SUM(CASE WHEN activity_name = 'makeready' THEN activity_time_minutes ELSE 0 END) AS makeready_minutes,
        SUM(CASE WHEN activity_name = 'running' THEN activity_time_minutes ELSE 0 END) AS running_minutes,
        SUM(CASE WHEN activity_name = 'production' THEN activity_time_minutes ELSE 0 END) AS production_minutes
      FROM production_records
      WHERE machine_name IN (${placeholders})
        AND DATE(job_start_time) >= ?
        AND DATE(job_start_time) <= ?
      GROUP BY batch_num
    `;
    const [rows] = await connection.execute(query, [...machineNames, startDate, endDate]);
    for (const row of rows) {
      if (!row.batch_num) continue;
      supplement.set(String(row.batch_num), {
        makereadyMinutes: parseFloat(row.makeready_minutes) || 0,
        runningMinutes: parseFloat(row.running_minutes) || 0,
        productionMinutes: parseFloat(row.production_minutes) || 0,
      });
    }
  } catch (err) {
    console.warn(`MySQL supplement unavailable for ${machineId}:`, err.message);
  } finally {
    if (connection) await connection.end().catch(() => {});
  }

  return supplement;
}

async function fetchEnrichmentData(startDate, endDate) {
  const oignEntries = await sapService.fetchAllInventoryGenEntryDocEntries(startDate, endDate);
  const { batchToPOMap, batchQtyMap, poAbsoluteEntries } =
    await sapService.fetchInventoryGenEntriesDetails(oignEntries);

  const prodOrderMap = await sapService.fetchProductionOrders(poAbsoluteEntries);

  const jobEntries = new Set();
  for (const po of prodOrderMap.values()) {
    if (po.U_JobEnt) jobEntries.add(parseInt(po.U_JobEnt, 10));
  }
  const jobMap = await sapService.fetchJobs(jobEntries);

  return { batchToPOMap, batchQtyMap, prodOrderMap, jobMap };
}

async function fetchRawDashboardData() {
  const endDate = formatDateYmd();
  const startDate = addCalendarDays(endDate, -BATCH_LOOKBACK_DAYS);

  await sapService.ensureSapSession();
  sapService.clearLastSapError();

  const [batchResults, enrichment] = await Promise.all([
    Promise.all(
      machines.map(async (m) => {
        const batches = await sapService.fetchMachineBatches(startDate, endDate, m.id);
        return { machineId: m.id, batches };
      }),
    ),
    fetchEnrichmentData(startDate, endDate),
  ]);

  const mysqlSupplements = await Promise.all(
    machines.map((m) => fetchMysqlSupplement(m.id, startDate, endDate)),
  );
  const makeReadyMaps = await Promise.all(
    machines.map((m) => fetchMakeReadyByJob(m.id, startDate, endDate)),
  );

  const byMachine = new Map();
  for (let i = 0; i < machines.length; i++) {
    const { machineId, batches } = batchResults[i];
    const classified = classifyBatches(batches, enrichment, mysqlSupplements[i], makeReadyMaps[i]);
    byMachine.set(machineId, classified);
  }

  return {
    generatedAt: new Date().toISOString(),
    startDate,
    endDate,
    timezone: REPORT_TIMEZONE,
    byMachine,
    sapAvailable: true,
  };
}

async function getDashboardData({ forceRefresh = false } = {}) {
  const now = Date.now();

  if (!forceRefresh && cache.all.data && now - cache.all.at < CACHE_TTL_MS) {
    return {
      ...cache.all.data,
      cached: true,
      cacheAgeSec: Math.round((now - cache.all.at) / 1000),
    };
  }

  if (inflight.has('all')) {
    return inflight.get('all');
  }

  const promise = (async () => {
    try {
      const data = await fetchRawDashboardData();
      cache.all = { at: Date.now(), data, error: null };
      for (const m of machines) {
        const classified = data.byMachine.get(m.id);
        cache.machines.set(m.id, { at: Date.now(), data: classified });
      }
      return {
        generatedAt: data.generatedAt,
        timezone: data.timezone,
        sapAvailable: true,
        sapError: null,
        cached: false,
        refreshMs: CACHE_TTL_MS,
        machines: buildMachineSummaries(data.byMachine),
      };
    } catch (err) {
      const sapError = sapService.getLastSapError() || err.message;
      console.error('Dashboard SAP fetch error:', sapError);

      if (cache.all.data) {
        return {
          generatedAt: cache.all.data.generatedAt,
          timezone: REPORT_TIMEZONE,
          sapAvailable: false,
          sapError,
          cached: true,
          stale: true,
          refreshMs: CACHE_TTL_MS,
          machines: buildMachineSummaries(cache.all.data.byMachine),
        };
      }

      return {
        generatedAt: new Date().toISOString(),
        timezone: REPORT_TIMEZONE,
        sapAvailable: false,
        sapError,
        cached: false,
        refreshMs: CACHE_TTL_MS,
        machines: machines.map((m) => ({
          id: m.id,
          name: m.name,
          status: 'idle',
          currentJob: null,
          lastCompletedAt: null,
        })),
      };
    } finally {
      inflight.delete('all');
    }
  })();

  inflight.set('all', promise);
  return promise;
}

function buildMachineSummaries(byMachine) {
  return machines.map((m) => {
    const data = byMachine.get(m.id);
    const currentJob = data?.currentJob || null;
    const lastCompletedAt = data?.lastCompletedAt || null;

    return {
      id: m.id,
      name: m.name,
      status: currentJob ? 'running' : 'idle',
      currentJob: currentJob
        ? {
            jobNo: currentJob.jobNo,
            fgCode: currentJob.fgCode,
            description: currentJob.description,
            operator: currentJob.operator,
            startTime: currentJob.startTime,
            startTimeISO: currentJob.startTimeISO,
            batchNo: currentJob.batchNo,
          }
        : null,
      lastCompletedAt,
    };
  });
}

async function getMachineDetail(machineId, { forceRefresh = false, startDate, endDate } = {}) {
  const machine = getMachineById(machineId);
  if (!machine) {
    const err = new Error(`Unknown machine: ${machineId}`);
    err.statusCode = 404;
    throw err;
  }

  if (startDate || endDate || forceRefresh) {
    const range = resolveDateRange(startDate, endDate);
    return refreshMachine(machineId, range);
  }

  const dashboard = await getDashboardData({ forceRefresh: false });
  const cached = cache.machines.get(machineId);
  const classified = cached?.data || null;

  if (!classified && dashboard.sapAvailable) {
    return {
      machine: { id: machine.id, name: machine.name },
      currentJob: null,
      completedJobs: [],
      sapAvailable: dashboard.sapAvailable,
      sapError: dashboard.sapError,
      generatedAt: dashboard.generatedAt,
      timezone: dashboard.timezone,
      refreshMs: CACHE_TTL_MS,
    };
  }

  return {
    machine: { id: machine.id, name: machine.name },
    currentJob: classified?.currentJob || null,
    completedJobs: classified?.completedJobs || [],
    sapAvailable: dashboard.sapAvailable,
    sapError: dashboard.sapError,
    generatedAt: dashboard.generatedAt,
    timezone: dashboard.timezone,
    refreshMs: CACHE_TTL_MS,
    stale: dashboard.stale || false,
  };
}

function resolveDateRange(from, to) {
  const today = formatDateYmd();
  let startDate =
    from && /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? String(from) : addCalendarDays(today, -BATCH_LOOKBACK_DAYS);
  let endDate = to && /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? String(to) : today;
  if (startDate > endDate) {
    const swap = startDate;
    startDate = endDate;
    endDate = swap;
  }
  return { startDate, endDate };
}

function buildMachineResponse(machine, classified, { startDate, endDate } = {}) {
  const currentJob = classified?.currentJob || null;
  const completedJobs = classified?.completedJobs || [];

  return {
    machine: { id: machine.id, name: machine.name },
    summary: {
      id: machine.id,
      name: machine.name,
      status: currentJob ? 'running' : 'idle',
      currentJob: currentJob
        ? {
            jobNo: currentJob.jobNo,
            fgCode: currentJob.fgCode,
            description: currentJob.description,
            operator: currentJob.operator,
            startTime: currentJob.startTime,
            startTimeISO: currentJob.startTimeISO,
            batchNo: currentJob.batchNo,
          }
        : null,
      lastCompletedAt: classified?.lastCompletedAt || null,
      completedCount: completedJobs.length,
    },
    currentJob,
    completedJobs,
    dateRange: { startDate, endDate },
    sapAvailable: true,
    sapError: null,
    generatedAt: new Date().toISOString(),
    timezone: REPORT_TIMEZONE,
    refreshMs: CACHE_TTL_MS,
  };
}

async function refreshMachine(machineId, { startDate, endDate } = {}) {
  const machine = getMachineById(machineId);
  if (!machine) {
    const err = new Error(`Unknown machine: ${machineId}`);
    err.statusCode = 404;
    throw err;
  }

  const completedRange = resolveDateRange(startDate, endDate);
  const runningRange = {
    startDate: addCalendarDays(formatDateYmd(), -BATCH_LOOKBACK_DAYS),
    endDate: formatDateYmd(),
  };
  const enrichStart =
    completedRange.startDate < runningRange.startDate ? completedRange.startDate : runningRange.startDate;

  await sapService.ensureSapSession();
  sapService.clearLastSapError();

  const [completedBatches, runningBatches, enrichment, mysqlSupplement, makeReadyMap] = await Promise.all([
    sapService.fetchMachineBatches(completedRange.startDate, completedRange.endDate, machineId),
    sapService.fetchMachineBatches(runningRange.startDate, runningRange.endDate, machineId),
    fetchEnrichmentData(enrichStart, runningRange.endDate),
    fetchMysqlSupplement(machineId, completedRange.startDate, completedRange.endDate),
    fetchMakeReadyByJob(machineId, completedRange.startDate, completedRange.endDate),
  ]);

  const runningData = classifyBatches(runningBatches, enrichment, mysqlSupplement, makeReadyMap);
  const completedData = classifyBatches(completedBatches, enrichment, mysqlSupplement, makeReadyMap);

  const classified = {
    currentJob: runningData.currentJob,
    completedJobs: completedData.completedJobs,
    lastCompletedAt: completedData.lastCompletedAt,
  };

  cache.machines.set(machineId, { at: Date.now(), data: classified, dateRange: completedRange });

  if (cache.all.data?.byMachine) {
    cache.all.data.byMachine.set(machineId, classified);
    cache.all.at = Date.now();
  }

  return buildMachineResponse(machine, classified, completedRange);
}

function clearCache() {
  cache.all = { at: 0, data: null, error: null };
  cache.machines.clear();
}

module.exports = {
  getDashboardData,
  getMachineDetail,
  refreshMachine,
  clearCache,
  machines,
  CACHE_TTL_MS,
};
