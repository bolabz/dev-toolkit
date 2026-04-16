#!/usr/bin/env npx tsx

/**
 * Gmail Toolkit — Optional Pre-Auth Script
 *
 * Usage: npx tsx scripts/setup-auth.ts [credentials-path] [token-path]
 *
 * This script is a convenience for pre-authenticating before configuring
 * Claude Desktop or deploying to a machine. It is NOT required — auth
 * happens seamlessly on first use in any mode.
 */

import { ensureAuthenticated } from '../src/shared/auth.js';
import { logger } from '../src/shared/logger.js';

const log = logger.child('setup');

const credentialsPath = process.argv[2] ?? './credentials.json';
const tokenPath = process.argv[3] ?? './token.json';

log.debug('Gmail Toolkit — Authentication Setup');
log.debug(`Credentials: ${credentialsPath}`);
log.debug(`Token will be saved to: ${tokenPath}`);

try {
  await ensureAuthenticated(credentialsPath, tokenPath, { interactive: true });
  log.info('Setup complete! Gmail Toolkit is ready to use.');
  log.info('Next steps:');
  log.info('  Library:  import { createGmailToolkit } from "gmail-toolkit"');
  log.info('  MCP:      Add to claude_desktop_config.json (see README)');
} catch (err) {
  if (err instanceof Error) {
    log.error(err.message);
  } else {
    log.error('Setup failed:', err);
  }
  process.exit(1);
}
