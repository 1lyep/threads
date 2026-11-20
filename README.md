# 线头 · Xiantou

线头是一个本地个人待办看板。人用浏览器拖卡片，agent 用 `xt` 读写同一份数据。所有项目共用六列，卡片可记录截止时间、预计用时和进展。数据保存在自己的电脑上。

卡片左下角的 `#编号` 与 `xt` 共用。支持聊天改名的 agent 会把实际处理过的卡片编号依次加到原标题前，例如 `#11 #12 修登录页报错`。

## 把这段话交给 agent

> 请从 https://github.com/1lyep/threads 部署线头。按本机系统和 CPU 下载最新 Release 的绿色包，核对 SHA-256，解压到我的用户目录里一个固定、可写的位置。安装当前 agent 的 threads skill，打开看板，验证网页和 CLI 都能读取数据。保留已有看板和自定义 skill。最后告诉我打开方式、数据位置和 skill 路径。

## 1. 选包并解压

绿色包内含应用、Node.js 运行时、网页图标和 skill。下载后可离线使用，无需管理员权限、npm 或全局安装。常见 Intel、AMD 电脑选 x64，Apple 芯片与 Windows on ARM 选 ARM64。Linux 包适用于支持 Node.js 24 的 glibc 发行版。

| 系统 | x64 | ARM64 |
| --- | --- | --- |
| Windows | [Windows x64 ZIP](https://github.com/1lyep/threads/releases/latest/download/xiantou-win-x64.zip) | [Windows ARM64 ZIP](https://github.com/1lyep/threads/releases/latest/download/xiantou-win-arm64.zip) |
| macOS | [Intel Mac](https://github.com/1lyep/threads/releases/latest/download/xiantou-darwin-x64.tar.gz) | [Apple 芯片 Mac](https://github.com/1lyep/threads/releases/latest/download/xiantou-darwin-arm64.tar.gz) |
| Linux | [Linux x64](https://github.com/1lyep/threads/releases/latest/download/xiantou-linux-x64.tar.gz) | [Linux ARM64](https://github.com/1lyep/threads/releases/latest/download/xiantou-linux-arm64.tar.gz) |

同一 Release 的 [SHA256SUMS.txt](https://github.com/1lyep/threads/releases/latest/download/SHA256SUMS.txt) 列出各包的校验值。Windows 用 `Get-FileHash .\xiantou-win-x64.zip -Algorithm SHA256`；macOS 用 `shasum -a 256 文件名`，Linux 用 `sha256sum 文件名`。与所选文件对应的一行一致后解压。Windows 可用资源管理器的“全部解压”或 `Expand-Archive`，macOS 和 Linux 可用 `tar -xzf 文件名`。进入解压出的 `xiantou` 文件夹，以下命令均从这个目录运行。

也可以克隆仓库或选择 GitHub 的 **Code → Download ZIP** 取得源码。启动器依次查找包内 Node.js、系统 Node.js 22+；两者均缺少时会从 nodejs.org 下载固定版本、校验后写入项目的 `runtime/`。macOS / Linux 如果解压工具没有保留执行权限，先运行 `chmod +x ./xt`。只取 skill 可下载 [SKILL.md](skills/threads/SKILL.md)，配合已部署的线头使用。

## 2. 安装当前 agent 的 skill

| Agent | Windows PowerShell | macOS / Linux |
| --- | --- | --- |
| Codex | `.\xt.cmd install-skill codex` | `./xt install-skill codex` |
| Claude Code | `.\xt.cmd install-skill claude` | `./xt install-skill claude` |

脚本打印安装路径，把启动器的绝对路径写入已安装的 skill，agent 因此能在其他项目目录中操作同一块看板。Codex 默认使用 `~/.codex/skills/threads/`（支持 `CODEX_HOME`），Claude Code 默认使用 `~/.claude/skills/threads/`（支持 `CLAUDE_CONFIG_DIR`）。重复安装同一份内容可直接成功；遇到已有且内容不同的 skill，脚本会提示其路径，保留原文件。比较两份内容、与用户确认如何合并后再更新。支持 SKILL.md 的其他 agent 可以把模板复制到其个人 skills 目录，并在文件末尾注明本机启动器的绝对路径。按宿主需要新开一次会话加载 skill。

## 3. 启动并验收

| 操作 | Windows PowerShell | macOS / Linux |
| --- | --- | --- |
| 在默认浏览器打开看板 | `.\xt.cmd open` | `./xt open` |
| 从 CLI 读取卡片 | `.\xt.cmd list --all --json` | `./xt list --all --json` |
| 查看完整命令 | `.\xt.cmd help` | `./xt help` |
| 前台运行服务、查看启动日志 | `.\xt.cmd serve` | `./xt serve` |

Windows 也可以直接双击 **xt.cmd**。打开看板会按需启动后台服务，默认地址为 [http://127.0.0.1:4321](http://127.0.0.1:4321)。无需自动唤起浏览器时可设置 `XT_NO_BROWSER=1`。前台运行的服务用 Ctrl+C 结束。

Agent 验收时，请确认网页出现「看板」「线头」两个入口；访问同一地址的 `/api/state` 应得到含 `threads` 和 `cards` 的 JSON。CLI 返回的卡片 ID 应与接口一致。首次部署的空白看板会返回空数组。确认 skill 文件末尾的启动器在其他目录也能运行 `list --all --json`。第一次使用时，可在网页的「线头」页建项目，再回到「看板」添加卡片。

## 数据与迁移

- 默认数据文件是安装目录中的 `data/threads.json`，首次写入时创建。备份或迁移前先停止写入，再复制这个文件。新版本解压到新目录后可复制旧数据，并更新已安装 skill 的启动器路径。
- 若已有另一块看板占用 4321，请用独立端口启动新副本。PowerShell 可先运行 `$env:PORT='4322'`，macOS / Linux 可运行 `export PORT=4322`。以后在相同环境中打开这份看板。
- 若需指定数据文件，可将 `THREADS_DATA` 设置为其绝对路径。CLI 和服务必须使用相同设置。只有改变数据文件路径时才需要此变量。
- 运行时随附 Node.js 的许可文本位于绿色包的 `runtime/LICENSE`；Tabler Icons 的许可文本位于 [web/vendor/tabler/LICENSE](web/vendor/tabler/LICENSE)。
