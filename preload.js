// preload.js
// Since contextIsolation is disabled, we don't need to use contextBridge
// Instead, we can just attach our functions directly to the window object

const { ipcRenderer } = require('electron');

// When using nodeIntegration: true and contextIsolation: false,
// we can modify the global window object directly
window.ipcAPI = {
  send: (channel, data) => {
    // whitelist channels
    let validChannels = ['connect-server'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel, func) => {
    let validChannels = ['connect-response'];
    if (validChannels.includes(channel)) {
      // Deliberately strip event as it includes `sender` 
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
  invoke: async (channel, data) => {
    let validChannels = ['connect-server', 'save-servers', 'load-servers'];
    if (validChannels.includes(channel)) {
      return await ipcRenderer.invoke(channel, data);
    }
  }
};

// No need to use contextBridge since contextIsolation is disabled
console.log('Preload script loaded successfully!');