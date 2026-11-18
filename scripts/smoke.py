"""Verify an extracted portable package with isolated data and skill directories."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen

root = Path(sys.argv[1]).resolve()
windows = os.name == "nt"
launcher = [str(root / ("xt.cmd" if windows else "xt"))]
node = root / "runtime" / ("node.exe" if windows else "node")
with tempfile.TemporaryDirectory() as work:
    work = Path(work)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = dict(os.environ, PORT=str(port), XT_NO_BROWSER="1", THREADS_DATA=str(work / "board.json"),
               CODEX_HOME=str(work / "codex"), CLAUDE_CONFIG_DIR=str(work / "claude"))
    def cli(*args):
        return subprocess.check_output(launcher + list(args), cwd=work, env=env, encoding="utf-8").strip()
    assert json.loads(cli("list", "--json")) == []
    for agent in ("codex", "claude"):
        file = Path(cli("install-skill", agent))
        assert file.is_relative_to(work)
        assert str(Path(launcher[0])) in file.read_text(encoding="utf-8")
        assert cli("install-skill", agent) == str(file)
    cli("thread", "add", "Demo")
    card = json.loads(cli("add", "Example", "--thread", "Demo", "--json"))
    cli("move", str(card["id"]), "review")
    base = f"http://127.0.0.1:{port}"
    # Start the foreground entry with the bundled runtime so we own the server PID.
    server = subprocess.Popen([node, root / "bin/xt.js", "serve"], cwd=work, env=env)
    try:
        for _ in range(60):
            try:
                with urlopen(base, timeout=2) as page:
                    assert 'id="board"' in page.read().decode()
                break
            except OSError:
                if server.poll() is not None: raise
                time.sleep(0.1)
        else: raise RuntimeError("Board did not start")
        with urlopen(base + "/api/state") as res:
            state = json.load(res)
        assert state["cards"][0]["column"] == "review"
        assert state["cards"][0]["id"] == card["id"]
        with urlopen(base + "/vendor/tabler/tabler-icons.woff2") as res:
            assert res.read(4) == b"wOF2"
        assert cli("open") == base
    finally:
        server.terminate()
        server.wait(timeout=10)
print("Verified runtime, CLI, web, offline icons and both agent skills.")
