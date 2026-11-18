import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function installSkill(agent) {
  const roots = {
    codex: join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills'),
    claude: join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'skills'),
  };
  if (!Object.hasOwn(roots, agent)) throw new Error('用法：xt install-skill codex 或 xt install-skill claude');
  const source = await readFile(new URL('../skills/threads/SKILL.md', import.meta.url), 'utf8');
  const launcher = fileURLToPath(new URL(process.platform === 'win32' ? '../xt.cmd' : '../xt', import.meta.url));
  const body = source + '\n## 本机调用\n\n本机启动器的绝对路径如下。请把命令示例中的 xt 替换成此路径，并按当前 shell 的规则引用。Windows PowerShell 使用调用运算符 &。\n\n' + launcher + '\n';
  const folder = resolve(roots[agent], 'threads');
  const path = join(folder, 'SKILL.md');
  await mkdir(folder, { recursive: true });
  try { await writeFile(path, body, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (await readFile(path, 'utf8') !== body) throw new Error('已有另一份 skill，请先比较并迁移：' + path);
  }
  console.log(path);
}
