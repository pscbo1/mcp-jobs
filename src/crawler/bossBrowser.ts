import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean) as string[];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error('Google Chrome not found. Install Chrome or set CHROME_PATH.');
  }
  return found;
}

export function bossCdpPort(): number {
  const n = Number(process.env.BOSS_CDP_PORT || 9222);
  return Number.isFinite(n) && n > 0 ? n : 9222;
}

export async function isCdpReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/json/version', timeout: 1500 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForCdp(port: number, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isCdpReady(port)) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`BOSS Chrome CDP not ready on port ${port}`);
}

export interface BossChromeSession {
  port: number;
  spawned: boolean;
  chromeProc?: ChildProcess;
  userDataDir: string;
}

/**
 * Ensure a real Google Chrome is running with the BOSS profile + remote debugging.
 * No Playwright.
 */
export async function ensureBossChrome(userDataDir: string): Promise<BossChromeSession> {
  fs.mkdirSync(userDataDir, { recursive: true });
  const port = bossCdpPort();

  if (await isCdpReady(port)) {
    return { port, spawned: false, userDataDir };
  }

  const chrome = findChrome();
  const chromeProc = spawn(
    chrome,
    [
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
    ],
    { stdio: 'ignore', detached: true, windowsHide: false }
  );
  chromeProc.unref();
  await waitForCdp(port);
  return { port, spawned: true, chromeProc, userDataDir };
}

export async function stopBossChrome(
  session: BossChromeSession,
  opts?: { keepAlive?: boolean }
): Promise<void> {
  const keepAlive =
    opts?.keepAlive ??
    (process.env.BOSS_CDP_KEEP === '1' || process.env.BOSS_CDP_KEEP === 'true');
  if (keepAlive) return;
  if (session.spawned && session.chromeProc?.pid) {
    try {
      process.kill(session.chromeProc.pid);
    } catch {
      // ignore
    }
  }
}
