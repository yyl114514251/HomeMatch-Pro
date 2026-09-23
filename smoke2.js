// R5 交互冒烟：真实点击匹配/筛选/对比/详情/同盘
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
  });
  win.webContents.on('console-message', (_e, level, message, line) => {
    if (level >= 2) console.log('CONSOLE[' + level + '] ' + message + ' @' + line);
  });
  win.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const r = await win.webContents.executeJavaScript(`(async () => {
          const out = {};
          // 1. 智能匹配
          document.getElementById('budgetSlider').value = 600;
          document.getElementById('budgetSlider').dispatchEvent(new Event('input'));
          document.getElementById('doMatch').click();
          out.matchItems = document.querySelectorAll('#matchResult .match-item').length;
          out.matchTop1 = document.querySelector('#matchResult .match-item') ?
            document.querySelector('#matchResult .match-item').innerText.slice(0, 50) : '';
          out.meta = document.getElementById('matchMeta').textContent;
          // 2. 打开第一个匹配详情
          const first = document.querySelector('#matchResult .match-item');
          if (first) { first.click(); }
          await new Promise(r => setTimeout(r, 150));
          out.detailOpen = !!document.getElementById('detail').classList.contains('open');
          out.detailHasBldg = document.getElementById('detailBody').innerText.indexOf('房源号') >= 0;
          // 3. 同盘对比 tab
          const sameBtn = [...document.querySelectorAll('.dtab')].find(b => b.dataset.tab === 'same');
          if (sameBtn) sameBtn.click();
          await new Promise(r => setTimeout(r, 120));
          out.sameRows = document.querySelectorAll('#tabSame tbody tr').length;
          // 4. 关闭详情，做筛选
          document.getElementById('detailClose').click();
          const cityChip = [...document.querySelectorAll('#fCity .chip')].find(c => c.textContent === '上海');
          if (cityChip) cityChip.click();
          document.getElementById('applyFilter').click();
          out.afterCityFilter = document.getElementById('resultCount').textContent;
          // 5. 对比：模拟添加两个楼盘
          const cmpInput = document.getElementById('cmpSearch');
          cmpInput.value = '汤臣';
          cmpInput.dispatchEvent(new Event('input'));
          await new Promise(r => setTimeout(r, 380));
          const cmpInput2 = document.getElementById('cmpSearch');
          cmpInput2.value = '古北';
          cmpInput2.dispatchEvent(new Event('input'));
          await new Promise(r => setTimeout(r, 380));
          out.cmpSlots = document.querySelectorAll('#cmpList .cmp-slot.filled').length;
          out.cmpRows = document.querySelectorAll('#cmpTable tbody tr').length;
          return out;
        })()`);
        console.log('SMOKE2 ' + JSON.stringify(r));
      } catch (e) { console.log('SMOKE2_ERROR ' + e.message); }
      app.exit(0);
    }, 3000);
  });
  win.loadFile('index.html');
});
