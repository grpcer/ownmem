#!/usr/bin/env node

import { runMemoryCli } from '../lib/features/ownmem.mjs';

runMemoryCli().then(code => {
  process.exitCode = code;
}).catch(error => {
  process.stderr.write(`ownmem: ${error.message}\n`);
  process.exitCode = 1;
});
