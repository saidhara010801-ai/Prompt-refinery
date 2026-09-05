import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

const projectId = 'clarift-phase-a-emulator';
const host = '127.0.0.1';

function emulatorJar() {
  const configured = process.env.FIRESTORE_EMULATOR_JAR?.trim();
  if (configured) return path.resolve(configured);
  const directory = path.join(homedir(), '.cache', 'firebase', 'emulators');
  if (!existsSync(directory)) return null;
  return readdirSync(directory)
    .filter((name) => /^cloud-firestore-emulator-v.*\.jar$/.test(name))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    .map((name) => path.join(directory, name))[0] ?? null;
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForPort(port, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Firestore emulator exited with code ${child.exitCode}.`);
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the Firestore emulator.');
}

async function run() {
  const jar = emulatorJar();
  if (!jar || !existsSync(jar)) {
    throw new Error('Firestore emulator JAR not found. Install it with Firebase CLI or set FIRESTORE_EMULATOR_JAR.');
  }
  const port = await availablePort();
  const emulator = spawn('java', [
    '-jar', jar,
    '--host', host,
    '--port', String(port),
    '--project_id', projectId,
    '--rules', path.resolve('firestore.rules'),
  ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let emulatorOutput = '';
  emulator.stdout.on('data', (chunk) => { emulatorOutput += String(chunk); });
  emulator.stderr.on('data', (chunk) => { emulatorOutput += String(chunk); });

  try {
    await waitForPort(port, emulator);
    const tests = spawn(process.execPath, ['--import', 'tsx', '--test', 'tests/emulator/firestore.test.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FIRESTORE_EMULATOR_HOST: `${host}:${port}`,
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId,
        GCLOUD_PROJECT: projectId,
      },
      stdio: 'inherit',
      windowsHide: true,
    });
    const exitCode = await new Promise((resolve, reject) => {
      tests.once('error', reject);
      tests.once('exit', (code) => resolve(code ?? 1));
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  } catch (error) {
    process.stderr.write(emulatorOutput);
    throw error;
  } finally {
    emulator.kill();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
