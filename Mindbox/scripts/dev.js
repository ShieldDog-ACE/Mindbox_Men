/**
 * 开发启动器:并行跑 vite 与 electron(后端由 electron 主进程拉起)。
 * 用法:npm run dev
 */
const { spawn } = require("child_process");

const procs = [];
function run(name, cmd, args, env = {}) {
  const p = spawn(cmd, args, {
    stdio: "inherit",
    shell: true,
    cwd: __dirname + "/..",
    env: { ...process.env, ...env },
  });
  p.on("exit", (code) => {
    console.log(`[${name}] exited (${code})`);
    shutdown();
  });
  procs.push(p);
}

function shutdown() {
  procs.forEach((p) => {
    try {
      p.kill();
    } catch {
      /* ignore */
    }
  });
  process.exit(0);
}
process.on("SIGINT", shutdown);

run("vite", "node node_modules/vite/bin/vite.js", []);
// 等 vite 端口就绪再开窗口
setTimeout(() => run("electron", "node node_modules/electron/cli.js .", [], { MINDBOX_DEV: "1" }), 2500);
