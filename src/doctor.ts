import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROJECT_ROOT, loadConfig } from './config';
import { loadEnvFile } from './lib/env-file';
import { getErrorCode, getErrorMessage } from './lib/errors';
import { PACKAGE_METADATA } from './lib/project';
import { MIN_NODE_VERSION_STRING, getNodeSupport } from './lib/runtime';

let failures = 0;

function pass(label: string, detail?: string): void {
  console.log(`[OK]   ${label}${detail ? `: ${detail}` : ''}`);
}

function warn(label: string, detail?: string): void {
  console.log(`[WARN] ${label}${detail ? `: ${detail}` : ''}`);
}

function fail(label: string, detail?: string): void {
  failures += 1;
  console.log(`[FAIL] ${label}${detail ? `: ${detail}` : ''}`);
}

function checkDataDirectory(dataFile: string): void {
  const directory = path.dirname(dataFile);
  const temporaryFile = path.join(
    directory,
    `.doctor-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`,
  );

  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporaryFile, 'ok', { encoding: 'utf8', flag: 'wx' });
    fs.unlinkSync(temporaryFile);
    pass('数据目录可写', directory);
  } catch (error) {
    try {
      fs.rmSync(temporaryFile, { force: true });
    } catch {
      // Best effort cleanup.
    }
    fail('数据目录不可写', `${directory} (${getErrorCode(error) ?? getErrorMessage(error)})`);
  }
}

function main(): void {
  console.log(`\n${PACKAGE_METADATA.name} ${PACKAGE_METADATA.version} - environment check`);
  console.log('-'.repeat(64));

  const nodeSupport = getNodeSupport();
  if (nodeSupport.supported) {
    pass(
      'Node.js 版本',
      `${process.version} (最低要求 v${MIN_NODE_VERSION_STRING})`,
    );
  } else {
    fail(
      'Node.js 版本过低',
      `${process.version} (最低要求 v${MIN_NODE_VERSION_STRING})`,
    );
  }

  const runtimeBits = process.arch === 'ia32' ? '32 位' : '64 位';
  const osArchitecture =
    process.env.PROCESSOR_ARCHITEW6432 ||
    process.env.PROCESSOR_ARCHITECTURE ||
    os.arch();
  console.log(
    `[INFO] Node.js 架构: ${process.arch} (${runtimeBits}), 操作系统架构: ${osArchitecture}`,
  );

  if (process.platform === 'win32') {
    pass('目标平台', `win32 ${os.release()}`);
  } else {
    warn(
      '当前不是 Windows',
      `${process.platform}; 代码可运行，但本项目主要面向 Windows`,
    );
  }

  if (process.arch === 'ia32') {
    const wow64 = process.env.PROCESSOR_ARCHITEW6432;
    console.log(
      `[INFO] 32 位进程${wow64 ? `运行在 64 位 Windows 的 WoW64 层 (${wow64})` : '运行在 32 位 Windows'}`,
    );
  }

  try {
    const loaded = loadEnvFile(path.join(PROJECT_ROOT, '.env'));
    pass('.env', loaded.length > 0 ? `已加载 ${loaded.length} 个变量` : '未创建或没有新变量');
  } catch (error) {
    fail('.env 解析失败', getErrorMessage(error));
  }

  let config;
  try {
    config = loadConfig();
    pass(
      '配置',
      `${config.host}:${config.port}, CORS ${
        config.corsOrigins.length > 0 ? config.corsOrigins.join(',') : '关闭'
      }, API Key ${config.apiKey ? '开启' : '关闭'}`,
    );
  } catch (error) {
    fail('配置无效', getErrorMessage(error).replace(/\n/g, ' '));
    console.log('\n结论: 请先修正配置。');
    process.exitCode = 1;
    return;
  }

  if (config.rateLimitMax > 0) {
    pass(
      '限流',
      `每个 IP ${config.rateLimitMax} 次 / ${config.rateLimitWindowMs} ms`,
    );
  } else {
    warn('限流', '已关闭 (RATE_LIMIT_MAX=0)');
  }

  const dependencyCount = Object.keys(PACKAGE_METADATA.dependencies).length;
  if (dependencyCount === 0) {
    pass('运行时依赖', '0 个（仅使用 Node.js 内置模块）');
  } else {
    warn('运行时依赖', `${dependencyCount} 个；请确认它们不包含原生模块`);
  }

  checkDataDirectory(config.dataFile);

  console.log('-'.repeat(64));
  console.log(
    'Windows 32/64 位说明: 同一份 TypeScript 编译产物无需按处理器位数重新编译。' +
      ' Node.js 22 LTS 是最后一个提供官方 win-x86 构建的版本，' +
      '32 位系统请使用 Node.js 22 LTS x86。',
  );

  if (failures > 0) {
    console.log(`\n结论: 检测到 ${failures} 个问题，请先修复。`);
    process.exitCode = 1;
  } else {
    console.log('\n结论: 当前环境可以运行 win-lite-backend。');
  }
}

try {
  main();
} catch (error) {
  console.error(
    `[doctor] Unexpected failure: ${
      error instanceof Error ? error.stack ?? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
}
