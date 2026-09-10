#!/usr/bin/env node
/**
 * Executable entry point for `dsh-token-ledger`.
 *
 * Kept as a thin wrapper so the CLI logic stays importable and testable.
 *
 * @module dsh-token-ledger/bin
 */

import { run } from '../lib/cli.js'

process.exitCode = run(process.argv.slice(2))
