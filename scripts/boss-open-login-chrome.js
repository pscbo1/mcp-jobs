/**
 * Open BOSS login with REAL Google Chrome + persistent user-data-dir.
 * No Playwright (Playwright blanks/flickers on zhipin).
 *
 *   node scripts/boss-open-login-chrome.js
 *
 * Profile: %USERPROFILE%\.cursor-boss-zhipin-profile (or BOSS_USER_DATA_DIR)
 * After QR/SMS login, close the window and keep the profile for MCP crawls.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const USER_DATA =
  process.env.BOSS_USER_DATA_DIR ||
  path.join(process.env.USERPROFILE || process.env.HOME || '.', '.cursor-boss-zhipin-profile');
const LOGIN_URL = 'https://www.zhipin.com/web/user/?ka=header-login';
const OUT = path.join(__dirname, '..', 'test-results', 'boss-login-status.json');

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p));
}

fs.mkdirSync(USER_DATA, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const chrome = findChrome();
if (!chrome) {
  console.error('Google Chrome not found. Install Chrome or set CHROME_PATH.');
  process.exit(1);
}

const args = [
  `--user-data-dir=${USER_DATA}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--new-window',
  LOGIN_URL,
];

fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      phase: 'awaiting_login_native_chrome',
      profileDir: USER_DATA,
      chrome,
      loginUrl: LOGIN_URL,
      note: 'Persistent profile via Chrome user-data-dir (equivalent to persistent context; no Playwright).',
      at: new Date().toISOString(),
    },
    null,
    2
  ),
  'utf8'
);

console.log('Launching native Chrome (no Playwright):');
console.log('  chrome =', chrome);
console.log('  profile =', USER_DATA);
console.log('  url =', LOGIN_URL);
console.log('Scan QR / SMS, then close the window. Profile is kept for later CDP crawls.');

const child = spawn(chrome, args, { detached: true, stdio: 'ignore' });
child.unref();
