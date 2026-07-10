/** Same machines and SAP U_BatchDt1 name variations as DPS_SENDER_NEW. */

const machines = [
  { id: 'nova-cut-1', name: 'Nova Cut 1' },
  { id: 'nova-cut-2', name: 'Nova Cut 2' },
  { id: 'ambition', name: 'Ambition' },
  { id: 'vision-fold', name: 'Vision Fold' },
  { id: 'nova-fold', name: 'Nova Fold' },
  { id: 'lam-narendra', name: 'Narendra (Lamination)' },
  { id: 'lam-yilee', name: 'Yilee (Lamination)' },
  { id: 'lam-yong-shun', name: 'Yong Shun (Lamination)' },
  { id: 'lam-witty', name: 'Witty (Lamination)' },
  { id: 'spotuv-horda', name: 'Horda (Spot UV)' },
  { id: 'spotuv-sakurai', name: 'Sakurai (Spot UV)' },
  { id: 'spotuv-apr', name: 'APR (Spot UV)' },
  { id: 'manual-mf', name: 'Manual MF' },
  { id: 'mk-foiling', name: 'MK Foiling' },
  { id: 'manual-mdc-1', name: 'Manual (MDC 1)' },
  { id: 'manual-mdc-2', name: 'Manual (MDC 2)' },
  { id: 'manual-mdc-3', name: 'Manual (MDC 3)' },
  { id: 'manual-mdc-4', name: 'Manual (MDC 4)' },
  { id: 'rigid-emmeci-1', name: 'Emmeci 1' },
  { id: 'rigid-emmeci-2', name: 'Emmeci 2' },
  { id: 'rigid-fuchu', name: 'Fuchu' },
];

const machineNameVariations = {
  'nova-cut-1': ['nova-cut-1', 'Nova Cut 1', 'NOVA CUT 1', 'novacut1', 'Novacut1'],
  'nova-cut-2': ['nova-cut-2', 'Nova Cut 2', 'NOVA CUT 2', 'novacut2', 'Novacut2'],
  ambition: ['Ambition', 'ambition', 'AMBITION'],
  'vision-fold': ['VISION FOLD', 'Vision Fold', 'visionfold', 'vision-fold', 'Visionfold', 'VISIONFOLD'],
  'nova-fold': ['Novafold', 'novafold', 'NOVA FOLD', 'Nova Fold', 'NOVAFOLD', 'nova fold', 'nova-fold', 'Novafold'],
  'lam-narendra': ['Narendra', 'narendra'],
  'lam-yilee': ['YI', 'YILEE', 'Yille', 'yilee'],
  'lam-yong-shun': ['yo', 'Yong Shun', 'yong shun', 'yong-shun'],
  'lam-witty': ['Witty', 'Wity', 'wity', 'Witty 2'],
  'spotuv-horda': ['HORDA', 'Horda', 'spotuv-horda'],
  'spotuv-sakurai': ['Sakurai', 'spotuv-sakurai'],
  'spotuv-apr': ['spotuv-apr', 'APR', 'APR ATHOS PLUS'],
  'manual-mf': ['manual-mf', 'Manual MF', 'MANUAL MF', 'manual mf', 'Manual-MF', 'MF (Foiling)'],
  'mk-foiling': ['mk-foiling', 'MK Foiling', 'MK FOILING', 'mk foiling', 'MK-Foiling', 'mkfoiling'],
  'manual-mdc-1': ['manual-mdc-1', 'MP1', 'Manual (MDC 1)', 'MANUAL MDC 1', 'manual mdc 1', 'MDC1', 'MDC 1'],
  'manual-mdc-2': ['manual-mdc-2', 'MP2', 'Manual (MDC 2)', 'MANUAL MDC 2', 'manual mdc 2', 'MDC2', 'MDC 2'],
  'manual-mdc-3': ['manual-mdc-3', 'MP3', 'Manual (MDC 3)', 'MANUAL MDC 3', 'manual mdc 3', 'MDC3', 'MDC 3'],
  'manual-mdc-4': ['manual-mdc-4', 'MP4', 'Manual (MDC 4)', 'MANUAL MDC 4', 'manual mdc 4', 'MDC4', 'MDC 4'],
  'rigid-emmeci-1': ['rigid-emmeci-1', 'EMECCI 1', 'Emmeci-1', 'EMMECI 1', 'Emecci-1'],
  'rigid-emmeci-2': ['rigid-emmeci-2', 'EMECCI 2', 'Emmeci-2', 'EMMECI 2', 'Emecci-2'],
  'rigid-fuchu': ['rigid-fuchu', 'FUCHU', 'Fuchu'],
};

function getMachineById(machineId) {
  return machines.find((m) => m.id === machineId) || null;
}

function getMachineNames(machineId) {
  return machineNameVariations[machineId] || [machineId];
}

function getMachineGroup(machineId) {
  if (machineId.startsWith('nova-cut') || machineId === 'ambition' || machineId === 'vision-fold' || machineId === 'nova-fold') {
    return 'Die Cut';
  }
  if (machineId.startsWith('lam-')) return 'Lamination';
  if (machineId.startsWith('spotuv-')) return 'Spot UV';
  if (machineId.startsWith('manual-') || machineId === 'mk-foiling') return 'Manual';
  if (machineId.startsWith('rigid-')) return 'Rigid';
  return 'Other';
}

module.exports = {
  machines,
  machineNameVariations,
  getMachineById,
  getMachineNames,
  getMachineGroup,
};
