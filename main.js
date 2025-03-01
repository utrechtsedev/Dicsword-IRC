// main.js - Electron main process
const { app, BrowserWindow, ipcMain } = require('electron');
const Store = require('electron-store');
const store = new Store();
const path = require('path');
const remoteMain = require('@electron/remote/main');

// Initialize remote module
remoteMain.initialize();

// Optional: disable hardware acceleration if you're experiencing issues
app.disableHardwareAcceleration();

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js'),
    }
  });
  
  // Enable remote module for this window
  remoteMain.enable(mainWindow.webContents);
  
  mainWindow.loadFile('index.html');
  
  // Open DevTools for debugging (uncomment if needed)
  mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();
  
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Handle IRC connections through IPC
ipcMain.handle('connect-server', async (event, serverInfo) => {
  // Connection handling will be implemented in the renderer process
  return { success: true, serverId: Date.now() };
});

// Save servers IPC handler
ipcMain.handle('save-servers', async (event, servers) => {
  store.set('servers', servers);
  return { success: true };
});

// Load servers IPC handler
ipcMain.handle('load-servers', async (event) => {
  return store.get('servers', {});
});