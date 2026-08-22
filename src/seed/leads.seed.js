'use strict';

/**
 * 3 exact assessment leads.
 * ownerId will be resolved to a MongoDB ObjectId using userCode at seed time.
 */
const leadSeedData = [
  {
    leadCode: 'LD-01',
    name: 'Ravi Client',
    phone: '+971501112222',
    ownerCode: 'U-01', // Ravi Kumar
  },
  {
    leadCode: 'LD-02',
    name: 'Meera Krishnan',
    phone: '+971552223344',
    ownerCode: 'U-02', // Priya Menon
  },
  {
    leadCode: 'LD-03',
    name: 'Tariq Hassan',
    phone: '+971524445566',
    ownerCode: 'U-03', // Bikash Thapa
  },
];

module.exports = { leadSeedData };
