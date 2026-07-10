const mysql = require('mysql2/promise');
const { getDbConfig } = require('../config/db');
const { machines, getMachineNames, getMachineById } = require('../config/machines');

const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE || 'Asia/Kolkata';

const STATE_LABELS = {
  offline: 'Offline',
  idle: 'Idle',
  running: 'Running',
  makeready: 'Make Ready',
  lunch: 'Lunch',
  cleaning: 'Cleaning',
  waiting_qc: 'Waiting QC',
  waiting_die: 'Waiting Die',
  waiting_input: 'Waiting Input',
  line_clearance: 'Line Clearance',
  feeder_trip: 'Feeder Trip',
  sticky_sheets: 'Sticky Sheets',
  sorting_waiting: 'Sorting Waiting',
  downtime_mech: 'Downtime Mech',
  downtime_elec: 'Downtime Elec',
};

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[\s_-]+/g, '').trim();
}

function buildMachineLookup() {
  const lookup = new Map();
  for (const m of machines) {
    lookup.set(normalizeKey(m.id), m.id);
    lookup.set(normalizeKey(m.name), m.id);
    for (const alias of getMachineNames(m.id)) {
      lookup.set(normalizeKey(alias), m.id);
    }
  }
  return lookup;
}

const machineLookup = buildMachineLookup();

function resolveDashboardMachineId(row) {
  if (!row) return null;
  return machineLookup.get(normalizeKey(row.machine_id))
    || machineLookup.get(normalizeKey(row.machine_name))
    || null;
}

/**
 * MySQL DATETIME values are stored as IST wall-clock (no timezone).
 * mysql2 Date objects treat those digits as UTC/local and Intl + Asia/Kolkata
 * shifts them again (+5:30). Always parse the clock digits directly.
 */
function extractMysqlWallClock(value) {
  if (value == null) return null;

  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    return { ymd: m[1], hour: m[2], minute: m[3], second: m[4] || '00' };
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (n) => String(n).padStart(2, '0');
    return {
      ymd: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
      hour: pad(value.getHours()),
      minute: pad(value.getMinutes()),
      second: pad(value.getSeconds()),
    };
  }

  return null;
}

function wallClockToISTDate(value) {
  const parts = extractMysqlWallClock(value);
  if (!parts) return null;
  const d = new Date(`${parts.ymd}T${parts.hour}:${parts.minute}:${parts.second}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDbDateTimeIST(value, { hour12 = true } = {}) {
  const istDate = wallClockToISTDate(value);
  if (!istDate) return value != null ? String(value) : null;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12,
  }).format(istDate);
}

function mysqlDateTimeToISO(value) {
  const parts = extractMysqlWallClock(value);
  if (!parts) return null;
  return `${parts.ymd}T${parts.hour}:${parts.minute}:${parts.second}+05:30`;
}

function formatDurationFromSeconds(seconds) {
  if (seconds == null || seconds < 0) return null;
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatStateLabel(state) {
  if (!state) return 'Idle';
  const key = String(state).toLowerCase();
  return STATE_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function hasFieldValue(value) {
  return value != null && String(value).trim() !== '';
}

/** Job loaded on machine — any of the three job identity fields set. */
function hasActiveJob(statusRow) {
  if (!statusRow) return false;
  return hasFieldValue(statusRow.current_fg_num)
    || hasFieldValue(statusRow.current_job_po)
    || hasFieldValue(statusRow.current_job_name);
}

function deriveUiStatus(row) {
  if (!row) return { status: 'idle', label: 'Idle' };

  const raw = row.current_state;
  if (raw == null || String(raw).trim() === '') {
    return { status: 'idle', label: 'Idle' };
  }

  const state = String(raw).toLowerCase().trim();
  if (state === 'running') return { status: 'running', label: 'Running' };
  if (state === 'makeready') return { status: 'makeready', label: 'Make Ready' };
  if (state === 'offline') return { status: 'offline', label: 'Offline' };
  if (state === 'idle') return { status: 'idle', label: 'Idle' };
  return { status: 'other', label: formatStateLabel(state) };
}

function isMachineOnline(row) {
  if (!row) return false;
  const state = String(row.current_state || '').toLowerCase().trim();
  return state !== 'offline' && state !== '';
}

async function withConnection(fn) {
  let connection;
  try {
    connection = await mysql.createConnection(getDbConfig());
    return await fn(connection);
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}

async function checkDatabaseConnection() {
  try {
    await withConnection(async (conn) => {
      await conn.query('SELECT 1');
    });
    return { ok: true, message: 'Connected' };
  } catch (err) {
    return { ok: false, message: err.message || 'Connection failed' };
  }
}

/**
 * Make-ready seconds per job (job_po) from machine_state_history.
 * job_po is the job number recorded when operator loads a job in Manish_DA.
 */
async function fetchMakeReadyByJob(machineId, startDate, endDate) {
  const byJob = new Map();
  const identifiers = [...new Set([machineId, ...getMachineNames(machineId)])];
  if (!identifiers.length) return byJob;

  try {
    await withConnection(async (conn) => {
      const idPlaceholders = identifiers.map(() => '?').join(', ');
      const query = `
        SELECT
          job_po,
          SUM(
            COALESCE(
              duration_seconds,
              TIMESTAMPDIFF(SECOND, started_at, COALESCE(ended_at, started_at))
            )
          ) AS makeready_seconds
        FROM machine_state_history
        WHERE state = 'makeready'
          AND job_po IS NOT NULL
          AND TRIM(job_po) != ''
          AND (machine_id IN (${idPlaceholders}) OR machine_name IN (${idPlaceholders}))
          AND started_at >= ?
          AND started_at < DATE_ADD(?, INTERVAL 1 DAY)
        GROUP BY job_po
      `;
      const params = [...identifiers, ...identifiers, `${startDate} 00:00:00`, endDate];
      const [rows] = await conn.execute(query, params);
      for (const row of rows) {
        const key = String(row.job_po).trim();
        if (!key) continue;
        byJob.set(key, Number(row.makeready_seconds) || 0);
      }
    });
  } catch (err) {
    console.warn(`machine_state_history unavailable for ${machineId}:`, err.message);
  }

  return byJob;
}

async function fetchJobStateDurations(conn, identifiers, jobPo) {
  const durations = { makeready: 0, running: 0 };
  if (!jobPo || !identifiers.length) return durations;
  const idPlaceholders = identifiers.map(() => '?').join(', ');
  const query = `
    SELECT state,
      SUM(
        COALESCE(
          duration_seconds,
          TIMESTAMPDIFF(SECOND, started_at, COALESCE(ended_at, NOW()))
        )
      ) AS total_seconds
    FROM machine_state_history
    WHERE job_po = ?
      AND state IN ('makeready', 'running')
      AND (machine_id IN (${idPlaceholders}) OR machine_name IN (${idPlaceholders}))
    GROUP BY state
  `;
  const params = [String(jobPo).trim(), ...identifiers, ...identifiers];
  const [rows] = await conn.execute(query, params);
  for (const row of rows) {
    if (row.state === 'makeready') durations.makeready = Number(row.total_seconds) || 0;
    if (row.state === 'running') durations.running = Number(row.total_seconds) || 0;
  }
  return durations;
}

function machineMatchClause(identifiers, alias = '') {
  const col = alias ? `${alias}.` : '';
  const ph = identifiers.map(() => '?').join(', ');
  return `( ${col}machine_id IN (${ph}) OR ${col}machine_name IN (${ph}) )`;
}

function hasOperatorName(value) {
  return value != null && String(value).trim() !== '';
}

async function fetchSessionById(conn, sessionId) {
  if (!sessionId) return null;
  const [rows] = await conn.execute(
    `SELECT session_id, operator_name, login_time, shift_type, shift_date, status
     FROM machine_shift_sessions WHERE session_id = ? LIMIT 1`,
    [sessionId],
  );
  return rows[0] || null;
}

async function fetchActiveSession(conn, identifiers) {
  if (!identifiers.length) return null;
  const match = machineMatchClause(identifiers);
  const [rows] = await conn.execute(
    `SELECT session_id, operator_name, login_time, shift_type, shift_date, status
     FROM machine_shift_sessions
     WHERE ${match}
       AND status = 'active'
       AND operator_name IS NOT NULL AND TRIM(operator_name) != ''
     ORDER BY login_time DESC
     LIMIT 1`,
    [...identifiers, ...identifiers],
  );
  return rows[0] || null;
}

async function fetchLastSession(conn, identifiers, { shiftDate, shiftType } = {}) {
  if (!identifiers.length) return null;
  const match = machineMatchClause(identifiers);
  const params = [...identifiers, ...identifiers];
  let shiftFilter = '';
  if (shiftDate && shiftType) {
    shiftFilter = ' AND shift_date = ? AND shift_type = ?';
    params.push(shiftDate, shiftType);
  }
  const [rows] = await conn.execute(
    `SELECT session_id, operator_name, login_time, shift_type, shift_date, status
     FROM machine_shift_sessions
     WHERE ${match}
       AND operator_name IS NOT NULL AND TRIM(operator_name) != ''
       ${shiftFilter}
     ORDER BY login_time DESC
     LIMIT 1`,
    params,
  );
  return rows[0] || null;
}

async function fetchLastHistoryOperator(conn, identifiers, { jobPo, shiftDate, shiftType } = {}) {
  if (!identifiers.length) return null;
  const match = machineMatchClause(identifiers);
  const params = [...identifiers, ...identifiers];
  let extra = '';
  if (jobPo) {
    extra += ' AND job_po = ?';
    params.push(String(jobPo).trim());
  }
  if (shiftDate && shiftType) {
    extra += ' AND shift_date = ? AND shift_type = ?';
    params.push(shiftDate, shiftType);
  }
  const [rows] = await conn.execute(
    `SELECT operator_name, started_at, shift_date, shift_type, session_id
     FROM machine_state_history
     WHERE ${match}
       AND operator_name IS NOT NULL AND TRIM(operator_name) != ''
       ${extra}
     ORDER BY started_at DESC
     LIMIT 1`,
    params,
  );
  return rows[0] || null;
}

async function resolveOperatorContext(conn, identifiers, statusRow) {
  const shiftDate = statusRow?.shift_date || null;
  const shiftType = statusRow?.shift_type || null;
  const jobPo = statusRow?.current_job_po || null;

  let sessionRow = null;
  if (statusRow?.current_session_id) {
    sessionRow = await fetchSessionById(conn, statusRow.current_session_id);
  }

  let operator = hasOperatorName(statusRow?.current_operator) ? String(statusRow.current_operator).trim() : null;
  let loginTime = sessionRow?.login_time || null;
  let operatorSource = operator ? 'machine_status' : null;

  if (!operator && hasOperatorName(sessionRow?.operator_name)) {
    operator = String(sessionRow.operator_name).trim();
    operatorSource = 'linked_session';
  }

  if (!operator || !loginTime) {
    const activeSession = await fetchActiveSession(conn, identifiers);
    if (!operator && hasOperatorName(activeSession?.operator_name)) {
      operator = String(activeSession.operator_name).trim();
      operatorSource = 'active_session';
    }
    if (!loginTime && activeSession?.login_time) {
      loginTime = activeSession.login_time;
      if (!sessionRow) sessionRow = activeSession;
    }
  }

  if (!operator || !loginTime) {
    const shiftSession = await fetchLastSession(conn, identifiers, { shiftDate, shiftType });
    if (!operator && hasOperatorName(shiftSession?.operator_name)) {
      operator = String(shiftSession.operator_name).trim();
      operatorSource = 'shift_session';
    }
    if (!loginTime && shiftSession?.login_time) {
      loginTime = shiftSession.login_time;
    }
  }

  if (!operator) {
    const jobHistoryOp = jobPo
      ? await fetchLastHistoryOperator(conn, identifiers, { jobPo, shiftDate, shiftType })
      : null;
    const historyOp = jobHistoryOp
      || await fetchLastHistoryOperator(conn, identifiers, { shiftDate, shiftType })
      || await fetchLastHistoryOperator(conn, identifiers);

    const picked = historyOp;
    if (picked && hasOperatorName(picked.operator_name)) {
      operator = String(picked.operator_name).trim();
      operatorSource = jobHistoryOp ? 'history_current_job' : 'history_last';
    }

    if (!loginTime) {
      const historySession = picked?.session_id
        ? await fetchSessionById(conn, picked.session_id)
        : null;
      if (historySession?.login_time) {
        loginTime = historySession.login_time;
      } else {
        const opShiftSession = await fetchLastSession(conn, identifiers, {
          shiftDate: picked?.shift_date || shiftDate,
          shiftType: picked?.shift_type || shiftType,
        });
        if (opShiftSession?.login_time) loginTime = opShiftSession.login_time;
      }
    }
  }

  if (!operator || !loginTime) {
    const lastSession = await fetchLastSession(conn, identifiers);
    if (!operator && hasOperatorName(lastSession?.operator_name)) {
      operator = String(lastSession.operator_name).trim();
      operatorSource = 'last_session';
    }
    if (!loginTime && lastSession?.login_time) {
      loginTime = lastSession.login_time;
    }
  }

  return { operator, loginTime, operatorSource };
}

function buildLivePayload(machineId, statusRow, operatorCtx, durations) {
  const machine = getMachineById(machineId);
  const ui = deriveUiStatus(statusRow);
  const jobActive = hasActiveJob(statusRow);
  const operator = jobActive ? (operatorCtx?.operator || null) : null;
  const loginTime = jobActive && operatorCtx?.loginTime
    ? formatDbDateTimeIST(operatorCtx.loginTime)
    : null;
  const startTime = statusRow?.job_loaded_at ? formatDbDateTimeIST(statusRow.job_loaded_at) : null;
  const mrElapsed = durations?.makeready > 0 ? formatDurationFromSeconds(durations.makeready) : null;
  const runElapsed = durations?.running > 0 ? formatDurationFromSeconds(durations.running) : null;

  return {
    found: !!statusRow,
    isOnline: isMachineOnline(statusRow),
    hasActiveJob: jobActive,
    currentState: statusRow?.current_state ?? null,
    stateLabel: ui.label,
    status: ui.status,
    operator,
    loginTime,
    operatorSource: jobActive ? (operatorCtx?.operatorSource || null) : null,
    runningJob: statusRow?.current_job_po || null,
    jobName: statusRow?.current_job_name || null,
    fgCode: statusRow?.current_fg_num || null,
    plannedQty: statusRow?.job_planned_qty != null ? statusRow.job_planned_qty : null,
    startTime,
    expectedMr: '—',
    expectedRunning: '—',
    expectedEnd: '—',
    timeRemaining: '—',
    makereadyElapsed: mrElapsed,
    runningElapsed: runElapsed,
    jobLoadedAtISO: mysqlDateTimeToISO(statusRow?.job_loaded_at),
    stateStartedAtISO: mysqlDateTimeToISO(statusRow?.state_started_at),
    lastEventAt: statusRow?.last_event_at ? formatDbDateTimeIST(statusRow.last_event_at) : null,
    shiftType: statusRow?.shift_type || null,
    shiftDate: statusRow?.shift_date || null,
    machineName: statusRow?.machine_name || machine?.name || machineId,
  };
}

/**
 * Live floor status from machine_status (+ session login, job state durations).
 */
async function fetchLiveStatusForMachines(machineIds) {
  const result = new Map();
  for (const id of machineIds) {
    result.set(id, buildLivePayload(id, null, null, null));
  }

  try {
    await withConnection(async (conn) => {
      const [statusRows] = await conn.query('SELECT * FROM machine_status');
      const statusByMachineId = new Map();

      for (const row of statusRows) {
        const dashboardId = resolveDashboardMachineId(row);
        if (!dashboardId || !machineIds.includes(dashboardId)) continue;
        statusByMachineId.set(dashboardId, row);
      }

      for (const machineId of machineIds) {
        const statusRow = statusByMachineId.get(machineId);
        const identifiers = [...new Set([machineId, ...getMachineNames(machineId)])];
        const jobActive = hasActiveJob(statusRow);
        const operatorCtx = jobActive
          ? await resolveOperatorContext(conn, identifiers, statusRow)
          : { operator: null, loginTime: null, operatorSource: null };
        const durations = jobActive && statusRow?.current_job_po
          ? await fetchJobStateDurations(conn, identifiers, statusRow.current_job_po)
          : { makeready: 0, running: 0 };
        result.set(machineId, buildLivePayload(machineId, statusRow, operatorCtx, durations));
      }
    });
  } catch (err) {
    console.warn('machine_status unavailable:', err.message);
    for (const id of machineIds) {
      const existing = result.get(id);
      result.set(id, { ...existing, dbError: err.message });
    }
  }

  return result;
}

function formatDurationMinutes(minutes) {
  if (minutes == null || minutes < 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function durationMinutesBetween(start, end) {
  const startIso = mysqlDateTimeToISO(start);
  const endIso = mysqlDateTimeToISO(end);
  if (!startIso || !endIso) return null;
  const diff = Math.round((new Date(endIso) - new Date(startIso)) / 60000);
  return diff >= 0 ? diff : null;
}

function mapProductionRecordRow(row) {
  const makereadyMinutes = parseFloat(row.makeready_minutes) || 0;
  const durationMinutes = durationMinutesBetween(row.job_start_time, row.job_end_time);
  const wallClock = extractMysqlWallClock(row.job_end_time);

  return {
    jobNo: row.po_num != null ? String(row.po_num).trim() : '',
    fgCode: row.fg_num != null ? String(row.fg_num).trim() : '',
    description: row.job_name != null ? String(row.job_name).trim() : '',
    operator: row.operator_name != null ? String(row.operator_name).trim() : '',
    batchNo: row.batch_num != null ? String(row.batch_num).trim() : '',
    startTime: formatDbDateTimeIST(row.job_start_time, { hour12: false }),
    endTime: formatDbDateTimeIST(row.job_end_time, { hour12: false }),
    startTimeISO: mysqlDateTimeToISO(row.job_start_time),
    endTimeISO: mysqlDateTimeToISO(row.job_end_time),
    endSortKey: wallClock ? `${wallClock.ymd} ${wallClock.hour}:${wallClock.minute}` : '0000-00-00 00:00',
    duration: formatDurationMinutes(durationMinutes),
    durationMinutes,
    makeReady: makereadyMinutes > 0 ? formatDurationMinutes(makereadyMinutes) : '—',
    makeReadySeconds: makereadyMinutes > 0 ? Math.round(makereadyMinutes * 60) : null,
    completedQty: row.completed_qty != null && Number(row.completed_qty) > 0
      ? Number(row.completed_qty)
      : null,
    qtyLabel: 'qty',
    fromDatabase: true,
  };
}

/**
 * Completed job history from production_records (grouped by batch).
 */
async function fetchCompletedJobsFromDb(machineId, startDate, endDate) {
  const machineNames = getMachineNames(machineId);
  if (!machineNames.length) return [];

  return withConnection(async (conn) => {
    const placeholders = machineNames.map(() => '?').join(', ');
    const query = `
      SELECT
        batch_num,
        MAX(po_num) AS po_num,
        MAX(fg_num) AS fg_num,
        MAX(job_name) AS job_name,
        MAX(operator_name) AS operator_name,
        MIN(job_start_time) AS job_start_time,
        MAX(job_end_time) AS job_end_time,
        SUM(CASE WHEN LOWER(activity_name) = 'makeready' THEN COALESCE(activity_time_minutes, 0) ELSE 0 END) AS makeready_minutes,
        COALESCE(
          NULLIF(SUM(CASE WHEN LOWER(activity_name) = 'production' THEN COALESCE(quantity_processed, 0) ELSE 0 END), 0),
          MAX(quantity_processed)
        ) AS completed_qty
      FROM production_records
      WHERE machine_name IN (${placeholders})
        AND job_start_time >= ?
        AND job_start_time < DATE_ADD(?, INTERVAL 1 DAY)
        AND job_end_time IS NOT NULL
      GROUP BY batch_num
      HAVING batch_num IS NOT NULL AND TRIM(batch_num) != ''
      ORDER BY job_end_time DESC
    `;
    const params = [...machineNames, `${startDate} 00:00:00`, endDate];
    const [rows] = await conn.execute(query, params);
    return rows.map(mapProductionRecordRow);
  });
}

module.exports = {
  checkDatabaseConnection,
  fetchMakeReadyByJob,
  fetchLiveStatusForMachines,
  fetchCompletedJobsFromDb,
  withConnection,
};
