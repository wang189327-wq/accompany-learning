'use strict';
const { build } = require('../build/cloud.cjs');
if (require.main === module)
  build()
    .then(() => console.log('云端界面已生成'))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
module.exports = { build };
