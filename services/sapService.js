const axios = require('axios');
const https = require('https');
const { getMachineNames } = require('../config/machines');

const config = {
  sapUrl: process.env.SAP_URL,
  sapCompany: process.env.SAP_COMPANY,
  sapUsername: process.env.SAP_USERNAME,
  sapPassword: process.env.SAP_PASSWORD,
};

const SAP_CONCURRENCY = Number(process.env.SAP_FETCH_CONCURRENCY || 24);
const SESSION_MAX_AGE_MS = 25 * 60 * 1000;

const sapClient = axios.create({
  baseURL: config.sapUrl,
  httpsAgent: new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
    maxSockets: SAP_CONCURRENCY,
  }),
  headers: { 'Content-Type': 'application/json' },
  timeout: 180000,
});

let sessionId = null;
let routeId = null;
let sessionCreatedAt = 0;
let lastSapError = null;

function getLastSapError() {
  return lastSapError;
}

function clearLastSapError() {
  lastSapError = null;
}

function formatSapError(err, context) {
  const sapMsg =
    err?.response?.data?.error?.message?.value ||
    err?.response?.data?.error?.message ||
    err?.response?.data?.error?.code;
  const status = err?.response?.status;
  const base = sapMsg || err?.message || 'SAP request failed';
  if (context && status) return `${context} (HTTP ${status}): ${base}`;
  if (context) return `${context}: ${base}`;
  return base;
}

async function mapPool(items, mapper, concurrency = SAP_CONCURRENCY) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let next = 0;
  const workers = Math.min(concurrency, items.length);

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await mapper(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

async function fetchAllPages(endpoint, params, { pageSize = 500, headers = {} } = {}) {
  const all = [];
  let skip = 0;

  while (true) {
    let resp;
    try {
      resp = await sapClient.get(endpoint, {
        params: { ...params, $skip: skip },
        headers: { Prefer: `odata.maxpagesize=${pageSize}`, ...headers },
      });
    } catch (err) {
      const msg = formatSapError(err, `SAP ${endpoint}`);
      lastSapError = msg;
      throw new Error(msg);
    }

    const rows = resp?.data?.value || [];
    all.push(...rows);

    if (rows.length < pageSize) break;
    skip += pageSize;
  }

  return all;
}

async function ensureSapSession() {
  if (sessionId && Date.now() - sessionCreatedAt < SESSION_MAX_AGE_MS) {
    return;
  }
  await sapLogin();
}

async function sapLogin() {
  const response = await sapClient.post('/Login', {
    CompanyDB: config.sapCompany,
    UserName: config.sapUsername,
    Password: config.sapPassword,
  });

  sessionId = null;
  routeId = null;
  const cookies = response.headers['set-cookie'];
  if (cookies) {
    cookies.forEach((cookie) => {
      if (cookie.includes('B1SESSION')) sessionId = cookie.split(';')[0].split('=')[1];
      if (cookie.includes('ROUTEID')) routeId = cookie.split(';')[0].split('=')[1];
    });
  }
  sapClient.defaults.headers.common.Cookie = `B1SESSION=${sessionId}; ROUTEID=${routeId}`;
  sessionCreatedAt = Date.now();
  clearLastSapError();
}

function buildMachineFilter(machineId) {
  const names = getMachineNames(machineId);
  return names.map((m) => `U_BatchDt1 eq '${m.replace(/'/g, "''")}'`).join(' or ');
}

function normalizeBatchNumber(batchRow) {
  return (batchRow?.Batch || batchRow?.DistNumber || batchRow?.BatchNumber || '').trim();
}

function ingestOignDocument(doc, batchToPOMap, batchQtyMap, poAbsoluteEntries) {
  if (!doc?.DocumentLines) return;
  for (const line of doc.DocumentLines) {
    const itemCode = line.ItemCode || '';
    if (!itemCode) continue;
    const baseEntry = line.BaseEntry;
    const baseType = line.BaseType;
    const batches = line.BatchNumbers || [];
    for (const b of batches) {
      const batchNum = b.BatchNumber || b.BatchNum || b.Batch || '';
      if (!batchNum) continue;
      const key = `${itemCode}_${batchNum}`;
      const qty = b.Quantity || 0;
      batchQtyMap.set(key, (batchQtyMap.get(key) || 0) + qty);
      if (baseEntry && baseType === 202) {
        batchToPOMap.set(key, baseEntry);
        poAbsoluteEntries.add(baseEntry);
      }
    }
  }
}

async function fetchMachineBatches(startDate, endDate, machineId) {
  const filter = `AdmissionDate ge '${startDate}' and AdmissionDate le '${endDate}' and (${buildMachineFilter(machineId)})`;
  return fetchAllPages('/BatchNumberDetails', {
    $filter: filter,
    $orderby: 'U_BatchDt2 asc',
  });
}

async function fetchAllInventoryGenEntryDocEntries(startDate, endDate) {
  return fetchAllPages('/InventoryGenEntries', {
    $filter: `DocDate ge '${startDate}' and DocDate le '${endDate}'`,
    $select: 'DocEntry',
  });
}

async function fetchInventoryGenEntriesDetails(docEntries) {
  const batchToPOMap = new Map();
  const batchQtyMap = new Map();
  const poAbsoluteEntries = new Set();

  const docs = await mapPool(docEntries, (d) =>
    sapClient
      .get(`/InventoryGenEntries(${d.DocEntry})`)
      .then((r) => r.data)
      .catch(() => null),
  );

  for (const doc of docs) {
    if (doc) ingestOignDocument(doc, batchToPOMap, batchQtyMap, poAbsoluteEntries);
  }

  return { batchToPOMap, batchQtyMap, poAbsoluteEntries };
}

function isProductionOrderItemLine(line) {
  const itemType = String(line?.ItemType || line?.LineType || '').toLowerCase();
  if (!itemType) return false;
  if (itemType.includes('resource') || itemType.includes('text')) return false;
  return itemType.includes('item');
}

function getPositiveItemBaseRatio(productionOrderLines) {
  if (!Array.isArray(productionOrderLines)) return null;
  const ratios = productionOrderLines
    .filter((line) => isProductionOrderItemLine(line))
    .map((line) => line.BaseQuantity)
    .filter((bq) => typeof bq === 'number' && bq > 0);
  if (ratios.length === 0) return null;
  return ratios[0];
}

async function fetchProductionOrders(poAbsoluteEntries) {
  const prodOrderMap = new Map();
  if (!poAbsoluteEntries.size) return prodOrderMap;

  const poArray = Array.from(poAbsoluteEntries);
  const poBatchSize = 20;
  const chunks = [];
  for (let i = 0; i < poArray.length; i += poBatchSize) {
    chunks.push(poArray.slice(i, i + poBatchSize));
  }

  const responses = await mapPool(chunks, async (batch) => {
    const filter = batch.map((ae) => `AbsoluteEntry eq ${ae}`).join(' or ');
    try {
      const resp = await sapClient.get('/ProductionOrders', {
        params: {
          $filter: filter,
          $select: 'AbsoluteEntry,DocumentNumber,ItemNo,PlannedQuantity,CompletedQuantity,U_JobEnt,U_PCode,ProductionOrderLines',
        },
        headers: { Prefer: 'odata.maxpagesize=500' },
      });
      return resp?.data?.value || [];
    } catch (err) {
      throw new Error(formatSapError(err, 'SAP ProductionOrders'));
    }
  });

  for (const rows of responses) {
    for (const po of rows) {
      prodOrderMap.set(po.AbsoluteEntry, {
        ...po,
        sheetBaseRatio: getPositiveItemBaseRatio(po.ProductionOrderLines),
        U_PCode: (po.U_PCode || '').toUpperCase().trim(),
      });
    }
  }

  return prodOrderMap;
}

async function fetchJobs(jobEntries) {
  const jobMap = new Map();
  if (!jobEntries.size) return jobMap;

  const jobArray = Array.from(jobEntries).filter((e) => !isNaN(e) && e > 0);
  const jobBatchSize = 10;

  for (let i = 0; i < jobArray.length; i += jobBatchSize) {
    const batch = jobArray.slice(i, i + jobBatchSize);
    const results = await mapPool(batch, (docEntry) =>
      sapClient
        .get(`/OMJD(${docEntry})`)
        .then((r) => r.data)
        .catch(() => null),
    );

    for (const job of results) {
      if (!job) continue;
      jobMap.set(job.DocEntry, {
        docNum: job.U_VerEntry ?? job.DocNum,
      });
    }
  }

  return jobMap;
}

module.exports = {
  ensureSapSession,
  fetchMachineBatches,
  fetchAllInventoryGenEntryDocEntries,
  fetchInventoryGenEntriesDetails,
  fetchProductionOrders,
  fetchJobs,
  normalizeBatchNumber,
  getLastSapError,
  clearLastSapError,
};
