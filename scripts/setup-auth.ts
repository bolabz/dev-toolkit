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

import { ensureAuthenticated } from '../src/auth.js';

const credentialsPath = process.argv[2] ?? './credentials.json';
const tokenPath = process.argv[3] ?? './token.json';

console.log('Gmail Toolkit — Authentication Setup');
console.log(`Credentials: ${credentialsPath}`);
console.log(`Token will be saved to: ${tokenPath}`);
console.log('');

try {
  await ensureAuthenticated(credentialsPath, tokenPath);
  console.log('');
  console.log('Setup complete! Gmail Toolkit is ready to use.');
  console.log('');
  console.log('Next steps:');
  console.log('  Library:  import { GmailToolkit } from "gmail-toolkit"');
  console.log('  MCP:      Add to claude_desktop_config.json (see README)');
} catch (err) {
  if (err instanceof Error) {
    console.error(err.message);
  } else {
    console.error('Setup failed:', err);
  }
  process.exit(1);
}
