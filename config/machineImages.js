/** Machine photo paths — maps machine id → image under /images/machines/ */

const machineImages = {
  'nova-cut-1': '/images/machines/nova-cut-1.png',
  'nova-cut-2': '/images/machines/nova-cut-2.png',
  ambition: '/images/machines/ambition.png',
  'vision-fold': '/images/machines/vision-fold.png',
  'nova-fold': '/images/machines/nova-fold.png',
  'lam-narendra': '/images/machines/lam-narendra.png',
  'lam-yilee': '/images/machines/lam-yilee.png',
  'lam-yong-shun': '/images/machines/lam-yong-shun.png',
  'lam-witty': '/images/machines/lam-witty.png',
  'spotuv-horda': '/images/machines/spotuv-horda.png',
  'spotuv-sakurai': '/images/machines/spotuv-sakurai.png',
  'spotuv-apr': '/images/machines/spotuv-apr.png',
  'rigid-emmeci-1': '/images/machines/rigid-emmeci-1.png',
  'rigid-emmeci-2': '/images/machines/rigid-emmeci-2.png',
};

const PLACEHOLDER_IMAGE = '/images/machines/placeholder.svg';

function getMachineImage(machineId) {
  return machineImages[machineId] || PLACEHOLDER_IMAGE;
}

module.exports = { machineImages, PLACEHOLDER_IMAGE, getMachineImage };
