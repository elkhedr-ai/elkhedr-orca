#!/usr/bin/env node

/**
 * Register Admin User — CLI Script
 *
 * Creates the first admin user for production deployment.
 * Reads credentials from environment or prompts interactively.
 *
 * Usage:
 *   node scripts/register-admin.js
 *   ORCA_ADMIN_USER=admin ORCA_ADMIN_EMAIL=admin@example.com ORCA_ADMIN_PASS=changeme node scripts/register-admin.js
 *
 * Security: Password is never logged or stored in plaintext.
 */

const path = require('path');
const readline = require('readline');

// Load env from .env.production if present, else .env
const fs = require('fs');
const envProdPath = path.join(__dirname, '..', '.env.production');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envProdPath)) {
  require('dotenv').config({ path: envProdPath });
} else if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

function prompt(rl, question, hidden = false) {
  return new Promise((resolve) => {
    if (hidden) {
      process.stdout.write(question);
      const stdin = process.openStdin();
      const onData = (char) => {
        char = char.toString();
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004':
            stdin.removeListener('data', onData);
            process.stdout.write('\n');
            break;
          default:
            process.stdout.write('*');
            break;
        }
      };
      stdin.on('data', onData);
      rl.question('', (answer) => {
        resolve(answer);
      });
    } else {
      rl.question(question, (answer) => {
        resolve(answer);
      });
    }
  });
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    // Get credentials from env or prompt
    const username = process.env.ORCA_ADMIN_USER || await prompt(rl, 'Admin username: ');
    const email = process.env.ORCA_ADMIN_EMAIL || await prompt(rl, 'Admin email: ');
    const password = process.env.ORCA_ADMIN_PASS || await prompt(rl, 'Admin password (min 8 chars): ', true);

    if (!username || !email || !password) {
      console.error('Error: username, email, and password are all required.');
      process.exit(1);
    }

    if (password.length < 8) {
      console.error('Error: password must be at least 8 characters.');
      process.exit(1);
    }

    // Import auth module (loads DB, etc.)
    const { registerUser } = require('../src/auth/index');

    console.log('\nRegistering admin user...');
    const result = await registerUser(username, email, password, 'admin');

    console.log('\nAdmin user registered successfully:');
    console.log(`  ID:       ${result.user.id}`);
    console.log(`  Username: ${result.user.username}`);
    console.log(`  Email:    ${result.user.email}`);
    console.log(`  Role:     ${result.user.role}`);
    console.log('\nStore these tokens securely (shown once):');
    console.log(`  Access Token:  ${result.tokens.accessToken.substring(0, 20)}...`);
    console.log(`  Refresh Token: ${result.tokens.refreshToken.substring(0, 20)}...`);
    console.log('\nFull tokens written to stdout above — copy them now if needed.');

  } catch (error) {
    if (error.message.includes('already exists')) {
      console.error('\nError: A user with that username or email already exists.');
      console.error('Use a different username/email, or update the existing user via the API.');
    } else {
      console.error('\nError:', error.message);
    }
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
