// 房产智能选房系统 · 安全桥接
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deepseekBridge', {
  chat: (payload) => ipcRenderer.invoke('deepseek-chat', payload)
});
