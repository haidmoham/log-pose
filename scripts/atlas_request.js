'use strict';

const { readAtlas } = require('../api/atlas-runtime.js');
async function main() {
  try { process.stdout.write(JSON.stringify(await readAtlas(new URLSearchParams(process.argv[2] || '')))); }
  finally { await readAtlas.close(); }
}
main().catch(() => { process.stderr.write('atlas request failed\n'); process.exitCode = 1; });
