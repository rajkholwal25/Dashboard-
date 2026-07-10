const MACHINE_IMAGES = {
  'nova-cut-1': '/static/images/machines/nova-cut-1.png',
  'nova-cut-2': '/static/images/machines/nova-cut-2.png',
  ambition: '/static/images/machines/ambition.png',
  'vision-fold': '/static/images/machines/vision-fold.png',
  'nova-fold': '/static/images/machines/nova-fold.png',
  'lam-narendra': '/static/images/machines/lam-narendra.png',
  'lam-yilee': '/static/images/machines/lam-yilee.png',
  'lam-yong-shun': '/static/images/machines/lam-yong-shun.png',
  'lam-witty': '/static/images/machines/lam-witty.png',
  'spotuv-horda': '/static/images/machines/spotuv-horda.png',
  'spotuv-sakurai': '/static/images/machines/spotuv-sakurai.png',
  'spotuv-apr': '/static/images/machines/spotuv-apr.png',
  'rigid-emmeci-1': '/static/images/machines/rigid-emmeci-1.png',
  'rigid-emmeci-2': '/static/images/machines/rigid-emmeci-2.png',
};

const PLACEHOLDER = '/static/images/machines/placeholder.svg';

function img(id) {
  return MACHINE_IMAGES[id] || PLACEHOLDER;
}

const MOCK_MACHINES = [
  { id: 'nova-cut-1', name: 'Nova Cut 1', group: 'Die Cut', status: 'running', fgCode: 'FG0005715-MON-DIE', operator: 'Avnish', startTime: '09 Jul 2026, 10:15 am', lastCompleted: '09 Jul 2026, 01:57 pm', image: img('nova-cut-1') },
  { id: 'nova-cut-2', name: 'Nova Cut 2', group: 'Die Cut', status: 'idle', lastCompleted: '09 Jul 2026, 02:25 pm', image: img('nova-cut-2') },
  { id: 'ambition', name: 'Ambition', group: 'Die Cut', status: 'running', fgCode: 'FG0008821-MON-DIE', operator: 'Ramesh', startTime: '09 Jul 2026, 11:00 am', lastCompleted: '09 Jul 2026, 02:24 pm', image: img('ambition') },
  { id: 'vision-fold', name: 'Vision Fold', group: 'Die Cut', status: 'idle', lastCompleted: '09 Jul 2026, 04:14 pm', image: img('vision-fold') },
  { id: 'nova-fold', name: 'Nova Fold', group: 'Die Cut', status: 'idle', lastCompleted: '09 Jul 2026, 02:26 pm', image: img('nova-fold') },
  { id: 'lam-narendra', name: 'Narendra (Lamination)', group: 'Lamination', status: 'idle', lastCompleted: '04 Jul 2026, 09:04 pm', image: img('lam-narendra') },
  { id: 'lam-yilee', name: 'Yilee (Lamination)', group: 'Lamination', status: 'idle', lastCompleted: '09 Jul 2026, 09:54 am', image: img('lam-yilee') },
  { id: 'lam-yong-shun', name: 'Yong Shun (Lamination)', group: 'Lamination', status: 'idle', lastCompleted: '08 Jul 2026, 07:48 pm', image: img('lam-yong-shun') },
  { id: 'lam-witty', name: 'Witty (Lamination)', group: 'Lamination', status: 'idle', lastCompleted: '09 Jul 2026, 09:04 am', image: img('lam-witty') },
  { id: 'spotuv-horda', name: 'Horda (Spot UV)', group: 'Spot UV', status: 'idle', lastCompleted: '09 Jul 2026, 01:01 pm', image: img('spotuv-horda') },
  { id: 'spotuv-sakurai', name: 'Sakurai (Spot UV)', group: 'Spot UV', status: 'idle', lastCompleted: '07 Jul 2026, 07:06 pm', image: img('spotuv-sakurai') },
  { id: 'spotuv-apr', name: 'APR (Spot UV)', group: 'Spot UV', status: 'idle', lastCompleted: '05 Jul 2026, 02:06 pm', image: img('spotuv-apr') },
  { id: 'manual-mf', name: 'Manual MF', group: 'Manual', status: 'idle', lastCompleted: '09 Jul 2026, 01:33 pm', image: PLACEHOLDER },
  { id: 'mk-foiling', name: 'MK Foiling', group: 'Manual', status: 'running', fgCode: 'FG0009102-FOIL', operator: 'Suresh', startTime: '09 Jul 2026, 09:30 am', lastCompleted: '09 Jul 2026, 02:23 pm', image: PLACEHOLDER },
  { id: 'manual-mdc-1', name: 'Manual (MDC 1)', group: 'Manual', status: 'idle', lastCompleted: '09 Jul 2026, 10:30 pm', image: PLACEHOLDER },
  { id: 'manual-mdc-2', name: 'Manual (MDC 2)', group: 'Manual', status: 'idle', lastCompleted: '09 Jul 2026, 04:57 pm', image: PLACEHOLDER },
  { id: 'manual-mdc-3', name: 'Manual (MDC 3)', group: 'Manual', status: 'idle', lastCompleted: '09 Jul 2026, 12:41 pm', image: PLACEHOLDER },
  { id: 'manual-mdc-4', name: 'Manual (MDC 4)', group: 'Manual', status: 'idle', lastCompleted: '08 Jul 2026, 07:48 pm', image: PLACEHOLDER },
  { id: 'rigid-emmeci-1', name: 'Emmeci 1', group: 'Rigid', status: 'idle', lastCompleted: '09 Jul 2026, 02:08 pm', image: img('rigid-emmeci-1') },
  { id: 'rigid-emmeci-2', name: 'Emmeci 2', group: 'Rigid', status: 'idle', lastCompleted: '09 Jul 2026, 02:09 pm', image: img('rigid-emmeci-2') },
  { id: 'rigid-fuchu', name: 'Fuchu', group: 'Rigid', status: 'idle', lastCompleted: null, image: PLACEHOLDER },
];

const MOCK_COMPLETED_JOBS = [
  { jobNo: '1672', fgCode: 'FG0010731-Art Paper', description: 'Box MitoActive Hair Growth Serum 30ml', operator: 'Krishna', batchNo: 'B010963', start: '08 Jul 2026, 05:53 pm', end: '08 Jul 2026, 07:48 pm', duration: '1h 55m', qty: 5220 },
  { jobNo: '1000949', fgCode: 'FG0005830-MON-LAM', description: 'SPC WS EDP FS 100ML-MON-Lamination', operator: 'Krishna', batchNo: 'B010952', start: '08 Jul 2026, 03:10 pm', end: '08 Jul 2026, 05:52 pm', duration: '2h 42m', qty: 8500 },
  { jobNo: '1000910', fgCode: 'FG0005715-MON-LAM', description: 'PACK SLEEVE FOR 9W/12W INVERTER', operator: 'Krishna', batchNo: 'B010939', start: '08 Jul 2026, 02:00 pm', end: '08 Jul 2026, 02:00 pm', duration: '0m', qty: 12920 },
  { jobNo: '1000957', fgCode: 'FG0006102-MON-LAM', description: 'Carton Premium Gift Set 250ml', operator: 'Krishna', batchNo: 'B010940', start: '07 Jul 2026, 06:30 pm', end: '07 Jul 2026, 09:15 pm', duration: '2h 45m', qty: 6800 },
  { jobNo: '1000881', fgCode: 'FG0005501-MON-LAM', description: 'Rigid Box Pharma Packaging', operator: 'Amit', batchNo: 'B010920', start: '07 Jul 2026, 10:00 am', end: '07 Jul 2026, 01:30 pm', duration: '3h 30m', qty: 4100 },
];
