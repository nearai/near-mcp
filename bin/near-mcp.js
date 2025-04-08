#!/usr/bin/env sh
":" //; command -v bun >/dev/null && exec /usr/bin/env bun "$0" "$@" || exec /usr/bin/env node --no-warnings --import tsx "$0" "$@"

import { execute } from '@oclif/core';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
async function run() {
  try {
    await execute({ dir: __dirname });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
run();