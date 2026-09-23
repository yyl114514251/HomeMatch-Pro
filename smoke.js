// 无头冒烟测试：加载页面、检查数据与渲染、捕获 JS 错误
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280, height: 900, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
  });
  win.webContents.on('console-message', (_e, level, message, line) => {
    if (level >= 2) console.log('CONSOLE[' + level + '] ' + message + ' @' + line);
  });
  win.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const r = await win.webContents.executeJavaScript(`(() => {
          const D = window.__DATA__;
          const cards = document.querySelectorAll('#browseBody .card');
          return {
            dataReady: !!D,
            master: D ? D.MASTER.length : -1,
            listings: D ? D.LISTINGS.length : -1,
            cities: D ? D.CITY_LIST.length : -1,
            stat: document.getElementById('statLine').textContent,
            cards: cards.length,
            firstCard: cards[0] ? cards[0].innerText.slice(0, 60) : '',
            sheetChips: document.querySelectorAll('#sheet .chip').length,
            recChips: document.querySelectorAll('#matchStyles .chip').length,
            navBtns: document.querySelectorAll('nav button').length
          };
        })()`);
        console.log('SMOKE_RESULT ' + JSON.stringify(r));
      } catch (e) { console.log('SMOKE_ERROR ' + e.message); }
      app.exit(0);
    }, 3000);
  });
  win.loadFile('index.html');
});
