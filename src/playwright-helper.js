/**
 * Shared Playwright Chromium helper for Render & local execution.
 * Ensures Chromium executable path is automatically discovered and launched safely.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}

function findChromiumExecutable() {
  const searchDirs = [
    path.join(__dirname, '../node_modules/playwright-core/.local-browsers'),
    path.join(process.cwd(), 'node_modules/playwright-core/.local-browsers'),
    path.join(process.env.HOME || '', '.cache/ms-playwright'),
    path.join(process.env.HOME || '', 'Library/Caches/ms-playwright'),
  ];

  function search(dir) {
    if (!dir || !fs.existsSync(dir)) return null;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const res = search(full);
          if (res) return res;
        } else if (['chrome', 'chrome.exe', 'Google Chrome for Testing', 'headless_shell', 'chromium'].includes(entry.name)) {
          return full;
        }
      }
    } catch {}
    return null;
  }

  for (const d of searchDirs) {
    const found = search(d);
    if (found) return found;
  }

  // Common Linux package paths
  const systemPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const sp of systemPaths) {
    if (fs.existsSync(sp)) return sp;
  }

  return null;
}

async function launchChromiumSafe(chromium, options = {}) {
  const mergedOptions = { ...options };

  if (!mergedOptions.executablePath) {
    const execPath = findChromiumExecutable();
    if (execPath) {
      mergedOptions.executablePath = execPath;
    }
  }

  try {
    return await chromium.launch(mergedOptions);
  } catch (launchErr) {
    const errMsg = String(launchErr && launchErr.message ? launchErr.message : '');
    if (errMsg.includes("Executable doesn't exist") || errMsg.includes('playwright install') || !mergedOptions.executablePath) {
      console.warn('[Playwright] Chromium browser executable not found. Running auto-install (node cli.js install chromium)...');
      try {
        const cliPath = path.join(__dirname, '../node_modules/playwright/cli.js');
        const nodeExec = process.execPath || 'node';
        if (fs.existsSync(cliPath)) {
          execSync(`"${nodeExec}" "${cliPath}" install chromium`, {
            env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' },
            stdio: 'inherit',
            timeout: 180000,
          });
        } else {
          execSync('PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium', {
            stdio: 'inherit',
            timeout: 180000,
          });
        }
        const execPath = findChromiumExecutable();
        if (execPath) {
          mergedOptions.executablePath = execPath;
        }
        return await chromium.launch(mergedOptions);
      } catch (retryErr) {
        console.error('[Playwright] Auto-install failed:', retryErr.message);
        throw launchErr;
      }
    }
    throw launchErr;
  }
}

module.exports = {
  findChromiumExecutable,
  launchChromiumSafe,
};
