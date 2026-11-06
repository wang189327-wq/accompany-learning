'use strict';
const { prepare } = require('../build/android.cjs');
if (require.main === module)
  prepare().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { prepare };
