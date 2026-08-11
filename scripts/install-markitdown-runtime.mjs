import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const UV_VERSION = '0.12.3';
const PYTHON_VERSION = '3.12';
const projectRoot = process.cwd();
const standaloneDirectory = join(projectRoot, '.next', 'standalone');
const runtimeDirectory = join(
  existsSync(standaloneDirectory) ? standaloneDirectory : projectRoot,
  '.markitdown-runtime'
);

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: environment,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(
        `${command} ${args.join(' ')} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`
      ));
    });
  });
}

function capture(command, args, environment) {
  return new Promise((resolve, reject) => {
    const output = [];
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    child.stdout.on('data', (chunk) => output.push(chunk));
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve(Buffer.concat(output).toString('utf8').trim());
        return;
      }

      reject(new Error(
        `${command} ${args.join(' ')} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`
      ));
    });
  });
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Could not download ${url}: ${response.status} ${response.statusText}`);
  }

  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

if (process.platform !== 'linux') {
  console.log('Skipping the packaged MarkItDown runtime outside the Linux App Hosting build.');
  process.exit(0);
}

const toolsDirectory = join(runtimeDirectory, '.tools');
const pythonDirectory = join(runtimeDirectory, 'python');
const pythonExecutable = join(runtimeDirectory, 'bin', 'python');
const installerPath = join(runtimeDirectory, 'uv-installer.sh');
const uvExecutable = join(toolsDirectory, 'uv');

await rm(runtimeDirectory, { recursive: true, force: true });
await mkdir(runtimeDirectory, { recursive: true });

try {
  console.log(`Installing uv ${UV_VERSION} for the MarkItDown build environment...`);
  await download(
    `https://releases.astral.sh/github/uv/releases/download/${UV_VERSION}/uv-installer.sh`,
    installerPath
  );
  await chmod(installerPath, 0o700);

  const environment = {
    ...process.env,
    UV_UNMANAGED_INSTALL: toolsDirectory,
    UV_NO_MODIFY_PATH: '1',
    UV_NO_PROGRESS: '1',
    UV_NO_CACHE: '1',
    UV_PYTHON_INSTALL_DIR: pythonDirectory,
    UV_PYTHON_INSTALL_BIN: '0',
  };

  await run('sh', [installerPath], environment);
  await run(uvExecutable, [
    'python',
    'install',
    PYTHON_VERSION,
    '--managed-python',
    '--no-bin',
  ], environment);
  const managedPython = await capture(uvExecutable, [
    'python',
    'find',
    PYTHON_VERSION,
    '--managed-python',
  ], environment);
  await run(uvExecutable, [
    'pip',
    'install',
    '--break-system-packages',
    '--python',
    managedPython,
    '--requirement',
    join(projectRoot, 'requirements-markitdown.txt'),
  ], environment);
  await mkdir(dirname(pythonExecutable), { recursive: true });
  await symlink(relative(dirname(pythonExecutable), managedPython), pythonExecutable);
  await run(pythonExecutable, [
    '-c',
    "from markitdown import MarkItDown; MarkItDown(); print('MarkItDown runtime verified')",
  ], environment);
} catch (error) {
  await rm(runtimeDirectory, { recursive: true, force: true });
  throw error;
} finally {
  await rm(installerPath, { force: true });
  await rm(toolsDirectory, { recursive: true, force: true });
}

console.log(`Packaged MarkItDown runtime is ready at ${runtimeDirectory}.`);
