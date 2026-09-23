// 房产智能选房系统 · Electron 主进程
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const https = require('https');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: '房产智能选房系统',
    backgroundColor: '#0f1420',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// DeepSeek 代理：绕开浏览器 CORS，渲染进程经 preload 桥接调用
ipcMain.handle('deepseek-chat', async (_event, { apiKey, messages }) => {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: messages,
      temperature: 0.7,
      max_tokens: 2500,
      stream: false
    });
    const req = https.request({
      hostname: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 120000
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.choices && j.choices[0]) resolve(j.choices[0].message.content);
          else reject(new Error(j.error ? j.error.message : 'DeepSeek 返回异常'));
        } catch (e) { reject(new Error('解析失败: ' + e.message)); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时（120s）')); });
    req.on('error', (e) => reject(new Error('网络错误: ' + e.message)));
    req.write(body);
    req.end();
  });
});
