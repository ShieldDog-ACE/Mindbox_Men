/**
 * Mindbox Electron 主进程。
 * 职责:拉起 Python 后端(sidecar) + 创建窗口。
 * 打包后布局:
 *   资源根 = process.resourcesPath
 *     ├── app.asar/dist/     渲染层(vite 产物)
 *     └── backend/           extraResources(mbpy + app + .pylibs)
 * 开发态根 = 项目目录。
 * 后端命令可被环境变量覆盖,为 PyInstaller 打包预留(任务书 0.1 第 4 条)。
 */
const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const DEV_ROOT = path.join(__dirname, "..");
let win = null;
let backend = null;

function resourceRoot() {
  return app.isPackaged ? process.resourcesPath : DEV_ROOT;
}

/**
 * 数据目录(vault)。必须放在 resources/ 之外——否则重装/重新打包会连人带库一起清掉。
 * 优先级:MINDBOX_VAULT 环境变量 > userData/vault(开发态用项目内 vault)。
 */
function vaultDir() {
  if (process.env.MINDBOX_VAULT) return process.env.MINDBOX_VAULT;
  return app.isPackaged ? path.join(app.getPath("userData"), "vault") : path.join(DEV_ROOT, "vault");
}

function backendCommand() {
  if (process.env.MINDBOX_BACKEND_CMD) {
    return { cmd: process.env.MINDBOX_BACKEND_CMD, args: [] };
  }
  const py = process.env.MINDBOX_PYTHON || path.join(resourceRoot(), "backend", "mbpy");
  if (!fs.existsSync(py)) {
    console.error("[mindbox] backend launcher not found:", py);
    return null;
  }
  return { cmd: py, args: [] };
}

function startBackend() {
  const spec = backendCommand();
  if (!spec) return;
  const vault = vaultDir();
  fs.mkdirSync(vault, { recursive: true });
  console.log("[mindbox] starting backend:", spec.cmd, "vault:", vault);
  backend = spawn(spec.cmd, spec.args, {
    stdio: "inherit",
    env: { ...process.env, MINDBOX_VAULT: vault },
  });
  backend.on("error", (e) => console.error("[mindbox] backend spawn failed:", e.message));
  backend.on("exit", (code) => console.log("[mindbox] backend exited:", code));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 960,
    backgroundColor: "#1e1e22",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env.MINDBOX_DEV === "1") {
    win.loadURL("http://localhost:5173");
  } else if (app.isPackaged) {
    win.loadFile(path.join(process.resourcesPath, "app.asar", "dist", "index.html"));
  } else {
    win.loadFile(path.join(DEV_ROOT, "dist", "index.html"));
  }
  win.on("closed", () => (win = null));
}

app.whenReady().then(() => {
  startBackend();
  createWindow();
});

app.on("window-all-closed", () => {
  if (backend) backend.kill();
  app.quit();
});
