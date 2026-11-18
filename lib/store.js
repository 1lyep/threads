import { open, readFile, mkdir, rename, unlink, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const dataPath = resolve(process.env.THREADS_DATA || fileURLToPath(new URL('../data/threads.json', import.meta.url)));

export function emptyState() {
  return { version: 1, rev: 0, nextThreadId: 1, nextCardId: 1, nextProgressId: 1, threads: [], cards: [] };
}

export async function readState() {
  await mkdir(dirname(dataPath), { recursive: true });
  try {
    return JSON.parse(await readFile(dataPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    throw new Error(`读取数据失败：${error.message}`);
  }
}

// 仅在持锁时调用；初始化空状态不算操作，rev 在每次操作写入时递增。
export async function writeState(state) {
  const temp = `${dataPath}.${randomUUID()}.tmp`;
  try {
    await open(temp, 'wx').then(async file => {
      try { await file.writeFile(`${JSON.stringify(state, null, 2)}\n`); }
      finally { await file.close(); }
    });
    await rename(temp, dataPath);
  } catch (error) {
    throw new Error(`写入数据失败：${error.message}`);
  } finally {
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function withLock(action) {
  await mkdir(dirname(dataPath), { recursive: true });
  const lockPath = `${dataPath}.lock`;
  const started = Date.now();
  let lock;
  while (!lock) {
    try {
      lock = await open(lockPath, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') throw new Error(`创建数据锁失败：${error.message}`);
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > 10000) {
          await unlink(lockPath);
          continue;
        }
      } catch (inspectionError) {
        if (inspectionError.code === 'ENOENT') continue;
        throw new Error(`清理数据锁失败：${inspectionError.message}`);
      }
      if (Date.now() - started >= 3000) throw new Error('等待数据锁超时（约 3 秒），请稍后重试');
      await delay(30 + Math.random() * 30);
    }
  }
  try {
    return await action();
  } finally {
    const owned = await lock.stat();
    await lock.close();
    try {
      const current = await stat(lockPath);
      if (current.ino === owned.ino) await unlink(lockPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`释放数据锁失败：${error.message}`);
    }
  }
}
