const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

let mainWindow = null;
let pythonProcess = null;

// isDev: explicitly set for hot-reload dev mode (Vite on 5173)
const isDev = process.env.ELECTRON_DEV === '1';

// Resolve the python server script path robustly
function getPythonScriptPath() {
  // 1. Explicitly set dev mode (npm run electron:dev)
  if (isDev) return path.join(__dirname, '..', 'python', 'server.py');
  // 2. Packaged app
  if (app.isPackaged) return path.join(process.resourcesPath, 'python', 'server.py');
  // 3. Unpackaged but running from built dist (npx electron .)
  const devPath = path.join(__dirname, '..', 'python', 'server.py');
  if (fs.existsSync(devPath)) return devPath;
  return path.join(process.resourcesPath, 'python', 'server.py');
}

function waitForServer(url, retries, delay) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      http.get(url, (res) => {
        if (res.statusCode === 200) resolve();
        else if (n > 0) setTimeout(() => attempt(n - 1), delay);
        else reject(new Error('Server not ready'));
      }).on('error', () => {
        if (n > 0) setTimeout(() => attempt(n - 1), delay);
        else reject(new Error('Server not ready'));
      });
    };
    attempt(retries);
  });
}

function startPythonServer() {
  const pythonExecutable = process.platform === 'win32' ? 'python' : 'python3';
  const scriptPath = getPythonScriptPath();

  console.log('Starting Python server at:', scriptPath);
  const spawnEnv = { ...process.env };
  // On Linux, pip --user installs to ~/.local/bin — add it to PATH
  if (process.platform !== 'win32') {
    const username = require('os').userInfo().username;
    spawnEnv.PATH = `/home/${username}/.local/bin:${process.env.PATH || '/usr/bin:/bin'}`;
  }
  pythonProcess = spawn(pythonExecutable, [scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: spawnEnv,
  });

  pythonProcess.stdout.on('data', (data) => {
    console.log('[Python]', data.toString().trim());
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error('[Python Error]', data.toString().trim());
  });

  pythonProcess.on('close', (code) => {
    console.log('Python process exited with code', code);
  });
}

async function createWindow() {
  // Start the python backend
  startPythonServer();

  // Wait for Python API to be ready
  try {
    await waitForServer('http://localhost:8765/health', 30, 1000);
    console.log('Python server is ready');
  } catch (e) {
    console.error('Python server failed to start:', e.message);
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#0f1117',
    frame: false,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:stateChange', { maximized: true, fullscreen: false }));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:stateChange', { maximized: false, fullscreen: false }));
  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('window:stateChange', { maximized: false, fullscreen: true }));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('window:stateChange', { maximized: mainWindow.isMaximized(), fullscreen: false }));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);

// Window control IPC
ipcMain.on('window:minimize', () => {
  if (!mainWindow) return;
  if (mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
    mainWindow.once('leave-full-screen', () => mainWindow.minimize());
  } else {
    mainWindow.minimize();
  }
});
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.on('window:toggleFullscreen', () => {
  if (!mainWindow) return;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
});
