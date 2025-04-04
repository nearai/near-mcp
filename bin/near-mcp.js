#!/usr/bin/env sh
':' //; exec npx -y tsx "$0" "$@"

import { execute } from '@oclif/core';
await execute({ dir: import.meta.url });
