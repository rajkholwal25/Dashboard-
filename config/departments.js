/** Department sections — matches VK Global Digital factory layout. */

const departments = [
  {
    id: 'printing',
    name: 'Printing',
    color: '#3B82F6',
    icon: '🖨',
    machines: [],
  },
  {
    id: 'diecutting',
    name: 'Diecutting',
    color: '#F97316',
    icon: '✂',
    machines: ['nova-cut-1', 'nova-cut-2'],
  },
  {
    id: 'pasting',
    name: 'Pasting',
    color: '#22C55E',
    icon: '📦',
    machines: ['ambition', 'vision-fold', 'nova-fold'],
  },
  {
    id: 'lamination',
    name: 'Lamination',
    color: '#A855F7',
    icon: '📄',
    machines: ['lam-narendra', 'lam-yilee', 'lam-yong-shun', 'lam-witty'],
  },
  {
    id: 'spot-uv',
    name: 'Spot UV',
    color: '#EC4899',
    icon: '✨',
    machines: ['spotuv-horda', 'spotuv-sakurai', 'spotuv-apr'],
  },
  {
    id: 'rigid',
    name: 'Rigid',
    color: '#06B6D4',
    icon: '🏗',
    machines: ['rigid-emmeci-1', 'rigid-emmeci-2', 'rigid-fuchu'],
  },
  {
    id: 'foiling',
    name: 'Foiling',
    color: '#EAB308',
    icon: '⭐',
    machines: ['mk-foiling'],
  },
  {
    id: 'manual',
    name: 'Manual Machines',
    color: '#64748B',
    icon: '🔧',
    machines: ['manual-mf', 'manual-mdc-1', 'manual-mdc-2', 'manual-mdc-3', 'manual-mdc-4'],
  },
];

const machineToDepartment = {};
departments.forEach((dept) => {
  dept.machines.forEach((machineId) => {
    machineToDepartment[machineId] = dept.id;
  });
});

function getDepartmentById(deptId) {
  return departments.find((d) => d.id === deptId) || null;
}

function getDepartmentForMachine(machineId) {
  const deptId = machineToDepartment[machineId];
  return deptId ? getDepartmentById(deptId) : null;
}

module.exports = {
  departments,
  machineToDepartment,
  getDepartmentById,
  getDepartmentForMachine,
};
