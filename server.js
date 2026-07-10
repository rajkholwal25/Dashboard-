require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { machines: machineList } = require('./config/machines');
const { getMachineImage } = require('./config/machineImages');
const { departments, getDepartmentById, getDepartmentForMachine } = require('./config/departments');
const {
  getDashboardData,
  getMachineDetail,
  refreshMachine,
  clearCache,
  CACHE_TTL_MS,
} = require('./services/machineJobService');
const { checkDatabaseConnection, fetchLiveStatusForMachines } = require('./services/dbService');
const sapService = require('./services/sapService');

const app = express();
const PORT = Number(process.env.PORT || 3002);
const HOST = process.env.HOST || '127.0.0.1';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, refreshMs: CACHE_TTL_MS });
});

app.get('/api/status', async (_req, res) => {
  const checkedAt = new Date().toISOString();
  const database = await checkDatabaseConnection();

  let sap = { ok: false, message: 'Not checked' };
  try {
    await sapService.ensureSapSession();
    sap = { ok: true, message: 'Connected' };
  } catch (err) {
    sap = { ok: false, message: sapService.getLastSapError() || err.message || 'Connection failed' };
  }

  res.json({ sap, database, checkedAt });
});

app.get('/api/departments', (_req, res) => {
  res.json({
    departments: departments.map((d) => ({
      id: d.id,
      name: d.name,
      color: d.color,
      icon: d.icon,
      machineCount: d.machines.length,
      machines: d.machines.map((id) => {
        const m = machineList.find((x) => x.id === id);
        return m
          ? { id: m.id, name: m.name, image: getMachineImage(m.id) }
          : { id, name: id, image: getMachineImage(id) };
      }),
    })),
    count: departments.length,
  });
});

app.get('/api/departments/:deptId/live', async (req, res) => {
  const dept = getDepartmentById(req.params.deptId);
  if (!dept) {
    res.status(404).json({ error: 'Department not found' });
    return;
  }

  const machineIds = dept.machines;
  const liveMap = await fetchLiveStatusForMachines(machineIds);
  const database = await checkDatabaseConnection();

  res.json({
    department: { id: dept.id, name: dept.name, color: dept.color },
    generatedAt: new Date().toISOString(),
    databaseAvailable: database.ok,
    databaseError: database.ok ? null : database.message,
    machines: machineIds.map((id) => {
      const m = machineList.find((x) => x.id === id);
      return {
        id,
        name: m?.name || id,
        image: getMachineImage(id),
        live: liveMap.get(id) || null,
      };
    }),
    refreshMs: CACHE_TTL_MS,
  });
});

app.get('/api/machines/live', async (_req, res) => {
  const machineIds = machineList.map((m) => m.id);
  const liveMap = await fetchLiveStatusForMachines(machineIds);
  const database = await checkDatabaseConnection();

  res.json({
    generatedAt: new Date().toISOString(),
    databaseAvailable: database.ok,
    databaseError: database.ok ? null : database.message,
    machines: machineIds.map((id) => {
      const m = machineList.find((x) => x.id === id);
      const live = liveMap.get(id) || null;
      const isActive = live?.status === 'running' || live?.status === 'makeready';
      return {
        id,
        name: m?.name || id,
        status: isActive ? 'running' : 'idle',
        live,
      };
    }),
    refreshMs: CACHE_TTL_MS,
  });
});

app.get('/api/machines/list', (_req, res) => {
  res.json({
    machines: machineList.map((m) => {
      const dept = getDepartmentForMachine(m.id);
      return {
        id: m.id,
        name: m.name,
        image: getMachineImage(m.id),
        department: dept ? { id: dept.id, name: dept.name, color: dept.color } : null,
      };
    }),
    count: machineList.length,
  });
});

app.get('/api/machines', async (req, res) => {
  const forceRefresh = req.query.refresh === '1';
  try {
    const data = await getDashboardData({ forceRefresh });
    res.json(data);
  } catch (err) {
    console.error('GET /api/machines error:', err.message);
    res.status(500).json({
      sapAvailable: false,
      sapError: err.message || 'Failed to fetch machines',
      machines: [],
    });
  }
});

app.get('/api/machines/:machineId', async (req, res) => {
  const forceRefresh = req.query.refresh === '1';
  const { from, to } = req.query;
  try {
    const data = await getMachineDetail(req.params.machineId, {
      forceRefresh,
      startDate: from,
      endDate: to,
    });
    const liveMap = await fetchLiveStatusForMachines([req.params.machineId]);
    res.json({ ...data, live: liveMap.get(req.params.machineId) || null });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error(`GET /api/machines/${req.params.machineId} error:`, err.message);
    res.status(status).json({
      error: err.message,
      databaseAvailable: false,
      databaseError: err.message,
      jobHistorySource: 'database',
    });
  }
});

app.get('/api/machines/:machineId/refresh', async (req, res) => {
  const { from, to } = req.query;
  try {
    const data = await refreshMachine(req.params.machineId, { startDate: from, endDate: to });
    const liveMap = await fetchLiveStatusForMachines([req.params.machineId]);
    res.json({ ...data, live: liveMap.get(req.params.machineId) || null, refreshed: true });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message, refreshed: false });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/department/:id', (req, res) => {
  if (!getDepartmentById(req.params.id)) {
    res.status(404).send('Department not found');
    return;
  }
  res.sendFile(path.join(__dirname, 'public', 'department.html'));
});

app.get('/machine/:id', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'machine.html'));
});

app.use('/static', express.static(path.join(__dirname, 'static')));

app.get('/preview', (_req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

app.get('/preview/machine', (_req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'machine.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Machine Live Dashboard running at http://${HOST}:${PORT}`);
  console.log(`Auto-refresh interval: ${CACHE_TTL_MS}ms`);
});
