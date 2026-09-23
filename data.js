/* ===== 房产智能选房系统 · 数据引擎 =====
   读取 192 个真实母盘 → 按 户型×楼层×景观×装修 组合生成 1.8万+ 房源
   价格规则：unitPrice = 母盘均价 × 楼层系数 × 景观系数 × 装修系数 × 面积系数 */
(function () {
  const RAW1 = window.__MASTER_RAW__ || [];
  const RAW2 = window.__MASTER_RAW_2__ || [];
  const CITY_ORDER_1 = ['北京','上海','深圳','广州','杭州','成都','南京','苏州','武汉','重庆','西安'];
  const CITY_ORDER_2 = ['天津','合肥','郑州','青岛','长沙','福州','厦门','济南','昆明','宁波','无锡','东莞','佛山'];
  const CITY_TIER = {
    '北京':'一线','上海':'一线','深圳':'一线','广州':'一线',
    '杭州':'新一线','成都':'新一线','南京':'新一线','苏州':'新一线','武汉':'新一线','重庆':'新一线',
    '西安':'新一线','天津':'新一线','合肥':'新一线','郑州':'新一线',
    '青岛':'二线','长沙':'二线','福州':'二线','厦门':'二线','济南':'二线','昆明':'二线',
    '宁波':'二线','无锡':'二线','东莞':'二线','佛山':'二线'
  };
  const CITY_AVG = {
    '北京':37112,'上海':41259,'深圳':51543,'广州':36023,
    '杭州':35673,'成都':16319,'南京':35000,'苏州':26711,'武汉':15000,'重庆':13000,
    '西安':16319,'天津':28000,'合肥':17068,'郑州':10048,
    '青岛':14000,'长沙':10720,'福州':28000,'厦门':32903,'济南':14208,'昆明':9552,
    '宁波':23000,'无锡':20000,'东莞':24000,'佛山':16000
  };
  const BAND_LABELS = ['远郊','近郊','主城','核心','顶豪'];

  // 母盘转对象
  const MASTER = [];
  function pushGroup(raw, cities) {
    cities.forEach((city, ci) => {
      for (let i = 0; i < 8; i++) {
        const r = raw[ci * 8 + i];
        if (!r) continue;
        MASTER.push({
          id: MASTER.length,
          name: r[0], band: r[1], district: r[2], type: r[3], unit: r[4],
          year: r[5], fee: r[6], metro: r[7], school: r[8], life: r[9],
          greening: r[10], plot: r[11], styles: r[12].split('/'), views: r[13].split('/'),
          loc: r[14], trans: r[15], note: r[16], city,
          tier: CITY_TIER[city] || '其他', cityAvg: CITY_AVG[city] || 10000,
          bandLabel: BAND_LABELS[r[1]]
        });
      }
    });
  }
  pushGroup(RAW1, CITY_ORDER_1);
  pushGroup(RAW2, CITY_ORDER_2);

  // 户型模板（按产品类型）
  const PLAN_BY_TYPE = {
    '高层':   [['1室1厅',55,1],['2室1厅',75,2],['2室2厅',90,2],['3室2厅',110,3],['3室2厅',125,3],['4室2厅',145,4]],
    '小高层': [['2室2厅',85,2],['3室2厅',105,3],['3室2厅',120,3],['4室2厅',140,4]],
    '洋房':   [['3室2厅',110,3],['4室2厅',130,4],['4室3厅',150,4],['5室2厅',170,5]],
    '大平层': [['3室2厅',170,3],['4室2厅',210,4],['4室3厅',250,4],['5室3厅',300,5],['5室3厅',360,5]],
    '别墅':   [['4室3厅',260,4],['5室3厅',320,5],['5室4厅',400,5],['6室4厅',500,6]]
  };
  const FLOOR_BANDS = [
    { code: 'low',  label: '低区',  f: 0.94 },
    { code: 'mid',  label: '中区',  f: 1.00 },
    { code: 'high', label: '高区',  f: 1.06 },
    { code: 'top',  label: '顶楼',  f: 1.13 }
  ];
  const VIEW_BANDS = [
    { code: 'full', label: '全景', f: 1.15 },
    { code: 'part', label: '部分', f: 1.05 },
    { code: 'none', label: '无景', f: 1.00 }
  ];
  const DECO_BANDS = [
    { code: 'new',    label: '精装', f: 1.00 },
    { code: 'lux',    label: '豪装', f: 1.03 },
    { code: 'origin', label: '毛坯', f: 0.97 }
  ];
  function areaFactor(a) {
    if (a >= 500) return 0.90;
    if (a >= 350) return 0.94;
    if (a >= 250) return 0.97;
    if (a >= 150) return 0.99;
    return 1.0;
  }

  // 每盘可用景观档
  function viewOptions(m) {
    const v = (m.views || ['无景观']).join('');
    if (v.indexOf('江景') >= 0 || v.indexOf('湖景') >= 0 || v.indexOf('海景') >= 0 ||
        v.indexOf('河景') >= 0 || v.indexOf('山景') >= 0) {
      return { viewName: (m.views[0] === '无景观' ? (m.views[1] || '景观') : m.views[0]), codes: ['full', 'part', 'none'] };
    }
    if (v.indexOf('部分景观') >= 0) return { viewName: '景观', codes: ['part', 'none'] };
    return { viewName: '无景观', codes: ['none'] };
  }
  function decoOptions(m) {
    if (m.band <= 1) return ['new', 'origin'];
    return ['new', 'lux', 'origin'];
  }

  // 生成房源
  const LISTINGS = [];
  MASTER.forEach(m => {
    const plans = PLAN_BY_TYPE[m.type] || PLAN_BY_TYPE['高层'];
    const isVilla = m.type === '别墅';
    const floors = isVilla ? [{ code: 'whole', label: '整栋', f: 1.0 }] : FLOOR_BANDS;
    const vOpt = viewOptions(m);
    const decos = decoOptions(m);
    const vfMap = { full: 1.15, part: 1.05, none: 1.00 };
    plans.forEach(pl => {
      floors.forEach(fl => {
        vOpt.codes.forEach(vc => {
          decos.forEach(dc => {
            const decoObj = DECO_BANDS.find(d => d.code === dc);
            const vBand = VIEW_BANDS.find(v => v.code === vc);
            const unit = Math.round(m.unit * fl.f * vfMap[vc] * decoObj.f * areaFactor(pl[1]));
            const total = Math.round(unit * pl[1] / 10000);
            const _id = LISTINGS.length;
            const bldg = (_id % 6) + 1;
            const unitNo = ((_id >> 2) % 3) + 1;
            const flNo = fl.code === 'low' ? 3 + _id % 4
                       : fl.code === 'mid' ? 10 + _id % 5
                       : fl.code === 'high' ? 20 + _id % 4
                       : fl.code === 'top' ? 30 + _id % 2 : 1;
            const roomNo = (_id % 4) + 1;
            const bldgNo = bldg + '幢' + unitNo + '单元' + flNo + '0' + roomNo + '室';
            LISTINGS.push({
              id: _id, bldgNo,
              mid: m.id, name: m.name, city: m.city, tier: m.tier,
              district: m.district, band: m.band, bandLabel: m.bandLabel,
              type: m.type, house: pl[0], area: pl[1], rooms: pl[2],
              floor: fl.label, floorCode: fl.code,
              view: vc === 'none' ? '无景观' : vOpt.viewName, viewCode: vc,
              deco: decoObj.label, decoCode: dc,
              unitPrice: unit, total,
              year: m.year, age: 2026 - m.year,
              fee: m.fee, prop: m.prop, metro: m.metro, metroOn: m.metro.indexOf('无') < 0 && m.metro.indexOf('规划') < 0,
              school: m.school, life: m.life, greening: m.greening, plot: m.plot,
              styles: m.styles, loc: m.loc, trans: m.trans,
              note: m.note, dev: m.tier
            });
          });
        });
      });
    });
  });

  // 筛选维度
  const CITY_LIST = [...new Set(MASTER.map(m => m.city))];
  const STYLE_LIST = [...new Set(MASTER.flatMap(m => m.styles))];
  const PRODUCT_LIST = ['1室','2室','3室','4室','5室','6室+'];
  const LOC_LIST = BAND_LABELS.map((l, i) => [String(i), l]);
  const FEE_BANDS = [['lt3','3元以下'],['3-6','3-6元'],['6-10','6-10元'],['gt10','10元以上']];
  const VIEW_TIER_LIST = [['none','无景观'],['part','普通景观'],['full','一线景观']];
  const PRICE_BANDS = [
    ['lt50','50万以下'],['50-100','50-100万'],['100-150','100-150万'],['150-200','150-200万'],
    ['200-300','200-300万'],['300-500','300-500万'],['500-800','500-800万'],['800-1200','800-1200万'],
    ['1200-2000','1200-2000万'],['2000-5000','2000-5000万'],['5000-10000','5000万-1亿'],['gt1e','1亿以上']
  ];
  const MASTER_IDX = Object.fromEntries(MASTER.map(m => [m.id, m]));
  const CITY_TIERS = Object.keys(CITY_TIER).map(c => ({ city: c, tier: CITY_TIER[c], avg: CITY_AVG[c] }));

  window.__DATA__ = {
    MASTER, LISTINGS, MASTER_IDX,
    CITY_LIST, CITY_TIERS, STYLE_LIST, PRODUCT_LIST, LOC_LIST, FEE_BANDS, VIEW_TIER_LIST, PRICE_BANDS,
    BAND_LABELS, CITY_TIER, CITY_AVG
  };
})();
