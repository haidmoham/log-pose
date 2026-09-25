'use strict';

const { handleMarketField } = require('../api/market-field.js');
const result = handleMarketField(new URLSearchParams(process.argv[2] || ''));
process.stdout.write(JSON.stringify(result));
