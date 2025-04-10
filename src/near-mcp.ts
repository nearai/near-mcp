#!/usr/bin/env node
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
void run();
