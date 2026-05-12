// ==UserScript==
// @name         鼠鼠选课Ultra
// @version      1.1
// @description  课表显示优化，白边加粗大字号，标题点击搜索课程，计算选上概率，修复弹出多个窗口
// @author       IAFEnvoy,ZMiaow优化
// @match        https://jwxt.shu.edu.cn/jwglxt/xsxk/*
// @match        https://byxk.shu.edu.cn/jwglxt/xsxk/*
// @require      https://scriptcat.org/lib/637/1.4.8/ajaxHooker.js
// @grant        GM_xmlhttpRequest
// @connect      course-rate.icu
// @run-at       document-start
// ==/UserScript==

/*
鼠鼠选课插件 Ultra-v1.1（油猴脚本）
基于 v0.7 进阶增强：
- 课表显示极致优化：底层采用 CSS Grid 布局，强制均分 16 等份小格，彻底解决不对齐问题（重度强迫症福音）；连续图块不再截断（直接显示 1-16 等）
- 分隔线调整：每个星期日（每天列）之间加入粗线，并在格子背景的第8/9周之间加入独立细线作为参考
- 交互增强：课表图块白边加粗大字号，标题点击搜索课程，点击课表块滚动定位
- 算法增强：实时计算选上概率（概率、排名/容量）
- 链接替换：修改教师跳转逻辑，弹窗直达 course-rate.icu 评价列表
- 稳定性：使用 setInterval 保障30秒自动跳过等功能
*/

const continuedTimeRegex = /星期([一二三四五六日])第([0-9]+)-([0-9]+)节{([0-9]+)-([0-9]+)周(\(([单双])\))?}/
const separatedTimeRegex = /星期([一二三四五六日])第([0-9]+)-([0-9]+)节{(([0-9]+)周(,([0-9]+)周)*)}/
const weekday = '空一二三四五六日'

let rawData = [], courseCache, tableCache

/**
 * 课程表优化和搜索优化
 * 包含学分统计、课程标题改写（点击搜索功能）等
 */
async function process() {
  let totalPoint = 0
  tableCache = Array.from({ length: 8 }, _ => Array.from({ length: 13 }, _ => Array.from({ length: 17 }, _ => ({ color: 'yellowgreen', kch_id: null }))))

  let classes = document.getElementsByClassName('outer_xkxx_list')
  for (let c of classes) {
    let kch_id = c.id.replace('right_', '')
    let raw = rawData.find(x => x.kch_id == kch_id)
    if (!raw) continue
    totalPoint += +raw.jxbxf
    let title = c.querySelector('h6'), type = c.querySelector('font').innerText

    if (raw.jxbmc) {
      let fontNode = c.querySelector('font');
      if (fontNode) {
        fontNode.style.fontSize = '14px';
      }

      title.innerHTML = '';
      let titleSpan = document.createElement('span');
      titleSpan.innerText = raw.jxbmc;
      titleSpan.style.fontSize = '16px';
      titleSpan.style.fontWeight = 'bold';
      titleSpan.style.color = '#337ab7';
      titleSpan.style.cursor = 'pointer';
      titleSpan.title = '点击按课程号查询此课';

      titleSpan.onclick = (e) => {
        e.stopPropagation();
        let searchInput = document.querySelector('input[name="searchInput"]');
        let searchBtn = document.querySelector('button[name="query"]');
        if (searchInput && searchBtn) {
          searchInput.value = raw.kch_id;
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          searchBtn.click();
        }
      };

      title.appendChild(titleSpan);
      title.appendChild(document.createTextNode(' '));
      if (fontNode) title.appendChild(fontNode);
    }

    await requestSelected(kch_id, raw.jxb_id, title, raw)
    for (let t of raw.sksj.split('<br/>'))
      fillTime(t, type == '待筛选' ? 'red' : 'aqua', tableCache, kch_id)
  }
  drawTable(tableCache)
  document.getElementById('xskbtable').rows[13].innerHTML = `<td colspan="8">
		<div class="col-md-12 col-sm-12">
		<div class="col-md-4 col-sm-4"><p style="margin-right:5px;float:left;background-color:red;height:15px;width:30px;"></p>待筛选</div>
		<div class="col-md-4 col-sm-4"><p style="margin-right:5px;float:left;background-color:aqua;height:15px;width:30px;"></p>已选上</div>
		<div class="col-md-4 col-sm-4"><p style="margin-right:5px;float:left;background-color:yellowgreen;height:15px;width:30px;"></p>未占用</div>
		<div class="col-md-4 col-sm-4">学分：${totalPoint}</div>
		</div></td>`
}

/**
 * 绘制右侧课程表（Ultra 版增强）
 * - 解决图块重叠和显示溢出，强迫症福音
 * - 增加星期列分隔粗线与学期半段细线
 * - 增加课程块白边字体和阴影
 */
function drawTable(table) {
  for (let i = 1; i <= 7; i++) {
    for (let j = 1; j <= 12; j++) {
      let ele = document.getElementById(`td_${i}-${j}`)
      if (!ele) continue;

      ele.innerHTML = '';
      ele.style.padding = '0';
      ele.style.position = 'relative';
      // 【添加粗线】每个星期日之间（每天的列之间）有粗线分隔
      ele.style.borderLeft = '3px solid #666';
      ele.style.borderRight = '3px solid #666';

      let bgContainer = document.createElement('div');
      bgContainer.style.display = 'grid';
      bgContainer.style.gridTemplateColumns = 'repeat(16, minmax(0, 1fr))';
      bgContainer.style.width = '100%';
      bgContainer.style.height = '100%';
      bgContainer.style.position = 'absolute';
      bgContainer.style.top = '0';
      bgContainer.style.left = '0';

      let segments = [];
      let current = { ...table[i][j][1], start: 1, end: 1 };
      for (let w = 2; w <= 16; w++) {
        // 不再从中间截断，连续的课程直接合并为 1-16 周
        if (table[i][j][w].color === current.color && table[i][j][w].kch_id === current.kch_id) {
          current.end = w;
        } else {
          segments.push(current);
          current = { ...table[i][j][w], start: w, end: w };
        }
      }
      segments.push(current);

      for (let seg of segments) {
        let block = document.createElement('div');
        // 【严格对齐】使用 CSS Grid 替代 Flex 百分比，强制均分 16 等份格子，彻底治愈强迫症
        block.style.gridColumn = `${seg.start} / ${seg.end + 1}`;
        block.style.gridRow = '1 / 2';
        block.style.height = '100%';
        block.style.backgroundColor = seg.color;
        block.style.boxSizing = 'border-box';

        if (seg.color !== 'yellowgreen') {
          block.innerText = seg.start === seg.end ? `${seg.start}` : `${seg.start}-${seg.end}`;
          block.style.display = 'flex';
          block.style.alignItems = 'center';
          block.style.justifyContent = 'center';
          block.style.fontWeight = 'bold';
          // 【白边大字号】取消溢出隐藏，强制不换行，稍微减小一点点字号，提高层级
          block.style.fontSize = '11.5px';
          block.style.color = '#111';
          block.style.whiteSpace = 'nowrap';
          block.style.zIndex = '1';
          block.style.textShadow = '-1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff, 0px 0px 4px #fff';
        }

        if (seg.kch_id) {
          block.style.cursor = 'pointer';
          block.title = `第${seg.start === seg.end ? seg.start : seg.start + '-' + seg.end}周 (点击跳转至课程)`;
          block.onclick = (e) => {
            e.stopPropagation();
            let target = document.getElementById('right_' + seg.kch_id);
            if (target) {
              target.scrollIntoView({ behavior: 'smooth', block: 'center' });
              let oldBg = target.style.backgroundColor;
              target.style.backgroundColor = 'rgba(255, 215, 0, 0.4)';
              setTimeout(() => { target.style.backgroundColor = oldBg; }, 1500);
            }
          }
        }
        bgContainer.appendChild(block);
      }
      ele.appendChild(bgContainer);

      // 【半学期细线】在格子的正中间（第8和第9周之间）画一条细线，独立于色块
      let overlayLine = document.createElement('div');
      overlayLine.style.position = 'absolute';
      overlayLine.style.left = '50%';
      overlayLine.style.top = '0';
      overlayLine.style.bottom = '0';
      overlayLine.style.borderLeft = '1.5px solid #999';
      overlayLine.style.pointerEvents = 'none'; // 鼠标穿透，不影响原本的 hover 和点击
      overlayLine.style.zIndex = '2'; // 绘制在最上层
      ele.appendChild(overlayLine);
    }
  }
}

function fillTime(time, color, table, kch_id = null) {
  let result = continuedTimeRegex.exec(time)
  if (result != null && result.length >= 6) {
    let day = weekday.indexOf(result[1])
    let sectionStart = +result[2], sectionEnd = +result[3], weekStart = +result[4], weekEnd = +result[5]
    let odd = result[7] != '双', even = result[7] != '单'
    for (let i = sectionStart; i <= sectionEnd; i++)
      for (let j = weekStart; j <= weekEnd; j++)
        if (j % 2 == 0 && even || j % 2 == 1 && odd)
          table[day][i][j] = { color, kch_id }
  } else {
    result = separatedTimeRegex.exec(time)
    if (result != null && result.length >= 5) {
      let day = weekday.indexOf(result[1])
      let sectionStart = +result[2], sectionEnd = +result[3], weeks = result[4].replaceAll('周', '').split(',')
      for (let i = sectionStart; i <= sectionEnd; i++)
        for (let week of weeks)
          table[day][i][+week] = { color, kch_id }
    }
  }
}

function checkConflict(table, time) {
  let result = continuedTimeRegex.exec(time)
  if (result != null && result.length >= 6) {
    let day = weekday.indexOf(result[1])
    let sectionStart = +result[2], sectionEnd = +result[3], weekStart = +result[4], weekEnd = +result[5]
    let odd = result[7] != '双', even = result[7] != '单'
    for (let i = sectionStart; i <= sectionEnd; i++)
      for (let j = weekStart; j <= weekEnd; j++)
        if (j % 2 == 0 && even || j % 2 == 1 && odd)
          if (table[day][i][j].color != 'yellowgreen') return true
  } else {
    result = separatedTimeRegex.exec(time)
    if (result != null && result.length >= 5) {
      let day = weekday.indexOf(result[1])
      let sectionStart = +result[2], sectionEnd = +result[3], weeks = result[4].replaceAll('周', '').split(',')
      for (let i = sectionStart; i <= sectionEnd; i++)
        for (let week of weeks)
          if (table[day][i][+week].color != 'yellowgreen') return true
    }
  }
  return false
}

/**
 * 获取教学班人数信息，计算并显示选课概率
 */
async function requestSelected(kch_id, jxb_id, obj, raw) {
  if (obj.innerHTML.indexOf('点击查看详情') > 0) return

  let parser = new DOMParser()
  let data = new FormData()
  data.append('kch_id', kch_id)
  data.append('jxb_id', jxb_id)
  data.append('xnm', $('#xkxnm').val())
  data.append('xqm', $('#xkxqm').val())
  let html = await fetch(`${_path}/xkgl/common_cxJxbrsmxIndex.html?time=${Date.now()}&gnmkdm=N253512`, {
    method: 'POST',
    body: data
  }).catch(console.error).then(res => res.text())

  let doc = parser.parseFromString(html, 'text/html')
  let table = doc.querySelectorAll("table")[0]
  let start = 0, end = 0
  for (let i = 1; i <= 4; i++) {
    end += +table.rows[i].cells[1].innerText
    if (table.rows[i].cells[2].innerText.indexOf('★') != -1) break
    start += +table.rows[i].cells[1].innerText
  }

  let bestRank = start + 1;
  let worstRank = end;
  let capacity = +raw.jxbrs;

  let prob = 0;
  if (worstRank <= capacity) {
    prob = 100;
  } else if (bestRank > capacity) {
    prob = 0;
  } else {
    prob = ((capacity - start) / (worstRank - start)) * 100;
  }

  let probStr = prob.toFixed(1) + '%';
  let probColor = prob === 100 ? 'green' : (prob === 0 ? 'red' : 'darkorange');

  let infoSpan = document.createElement('span');
  infoSpan.style.fontSize = '14px';
  infoSpan.style.fontWeight = 'normal';
  infoSpan.innerHTML = `
    <br><span style="color:#666">排名/容量：${bestRank}-${worstRank}/${capacity} </span>
    <span style="color:${probColor}; font-weight:bold;">[概率:${probStr}]</span>
    <a href="javascript:void(0)" class="rank-detail-btn" style="color:#337ab7; text-decoration:underline;">点击查看详情</a>
  `;

  infoSpan.querySelector('.rank-detail-btn').onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    ckjxbrsxx(kch_id, raw.jxb_id);
  };

  obj.appendChild(infoSpan);
}

/**
 * 在指定 DOM 元素上注入课程评分 emoji
 * 
 * 与 rate 界面的 renderScoreEmoji 逻辑完全一致：
 *   - 评价总数 < 阈值（默认10）→ 显示 na.png（暂无评分）
 *   - 否则取 Math.ceil(average) 夹在 [minScore, maxScore] → 显示 {idx}.png
 *
 * @param {HTMLElement} domElement  - 要挂载 emoji 的目标 DOM 元素
 * @param {string}      courseName  - 课程名（对应 /rate/:course/:teacher 中的 :course）
 * @param {string}      teacherName - 教师名（对应 /rate/:course/:teacher 中的 :teacher）
 * 
 * PS：这一段是DeepSeek写的
 */
async function injectRateEmoji(domElement, courseName, teacherName) {
  const base = 'https://course-rate.icu';

  // 构建 API 请求 URL（课程名/教师名中的特殊字符需要编码）
  const apiUrl = base + '/api/rate/' + encodeURIComponent(courseName) + '/' + encodeURIComponent(teacherName);

  // -------- 评分范围默认值（与 config.go 中的 defaultConfig 一致） --------
  const DEFAULT_MIN_SCORE = 1;
  const DEFAULT_MAX_SCORE = 10;
  const DEFAULT_MIN_RATINGS_FOR_EMOJI = 10;

  // -------- 简易缓存：避免同一课程+教师反复请求后端 --------
  // 缓存挂在函数自身上跨调用共享；key = "courseName|teacherName"
  if (!injectRateEmoji._cache) {
    injectRateEmoji._cache = {};
    injectRateEmoji._pending = {};
  }
  var cacheKey = courseName + '|' + teacherName;

  /**
   * 根据数据决定 emoji 文件名和提示文本，然后创建 <img> 并挂载到 DOM
   * @param {object|null} data  - 解析后的 API 响应，为 null 表示请求失败
   */
  function renderEmoji(data) {
    var emojiName, altText, tooltip;
    if (!data) return;
    var total = Number(data.total) || 0;
    var average = Number(data.average) || 0;
    var minCount = Number(data.min_ratings_for_emoji) || DEFAULT_MIN_RATINGS_FOR_EMOJI;

    if (total < minCount) {
      emojiName = 'na';
      altText = '暂无评分';
      tooltip = '暂无评分，点击查看评价';
    } else {
      var idx = Math.max(DEFAULT_MIN_SCORE, Math.min(DEFAULT_MAX_SCORE, Math.ceil(average)));
      emojiName = String(idx);
      var scoreText = '评分: ' + average.toFixed(1) + ' / ' + total + ' 条评价';
      altText = scoreText;
      tooltip = scoreText + '，点击查看评价';
    }

    var img = document.createElement('img');
    img.src = base + '/img/score/' + emojiName + '.png';
    img.alt = altText;
    img.title = tooltip;
    img.style.cursor = 'pointer';
    img.style.verticalAlign = 'middle';
    img.style.width = '24px'

    img.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var rateUrl = base + '/rate/' + encodeURIComponent(courseName) + '/' + encodeURIComponent(teacherName);
      var w = 500, h = 700;
      var left = (window.screen.width - w) / 2;
      var top = (window.screen.height - h) / 2;
      window.open(rateUrl, 'ratePopup_' + courseName + '_' + teacherName, `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
    });
    domElement.appendChild(img);
  }

  // 命中缓存 → 直接渲染
  if (Object.hasOwn(injectRateEmoji._cache, cacheKey)) {
    renderEmoji(injectRateEmoji._cache[cacheKey]); return;
  }

  // 正在请求中 → 等待结果（避免并发重复请求）
  if (injectRateEmoji._pending[cacheKey]) {
    injectRateEmoji._pending[cacheKey].push(renderEmoji); return;
  }

  // 发起新请求
  injectRateEmoji._pending[cacheKey] = [renderEmoji];

  GM_xmlhttpRequest({
    method: 'GET', url: apiUrl,
    onload: function (resp) {
      var result = null;
      if (resp.status === 200) {
        try {
          var data = JSON.parse(resp.responseText);
          // 仅在后端未返回 error 时视为有效结果
          if (data && !data.error) result = data;
        } catch (e) { }
      }
      // 写入缓存
      injectRateEmoji._cache[cacheKey] = result;
      // 消费所有等待中的回调
      var callbacks = injectRateEmoji._pending[cacheKey] || [];
      delete injectRateEmoji._pending[cacheKey];
      for (var i = 0; i < callbacks.length; i++) callbacks[i](result);
    },
    onerror: function () {
      // 网络错误也缓存为 null，避免反复重试造成服务器压力
      injectRateEmoji._cache[cacheKey] = null;
      var callbacks = injectRateEmoji._pending[cacheKey] || [];
      delete injectRateEmoji._pending[cacheKey];
      for (var i = 0; i < callbacks.length; i++) callbacks[i](null);
    }
  });
}

/**
 * 初始化代码
 */
function initialize() {
  initializeHandler()
  let div1 = document.createElement('div')
  div1.innerHTML = `<div class="col-sm-12 col-md-12 condition-row" style="display: block;">
        <div class="form-group form-group-sm" style="margin-bottom:5px;">
            <label class="col-sm-2 col-md-2 control-label title">教师姓名/工号：</label><div class="col-sm-9 col-md-9 items">
                <ul><li class="col-sm-12 col-md-12"><div class="input-group input-group-xs">
                    <input type="text" id="teacherFilter" class="form-control pull-left input-xs input-xs-last fixed">
                </div></li></ul>
            </div>
        </div>
    </div>`
  document.getElementsByClassName("condition-item")[0].appendChild(div1)

  let div2 = document.createElement('div')
  div2.innerHTML = `<div class="col-sm-12 col-md-12 condition-row" style="display: block;">
        <div class="form-group form-group-sm" style="margin-bottom:5px;">
            <label class="col-sm-2 col-md-2 control-label title">隐藏冲突课程：</label><div class="col-sm-9 col-md-9 items">
                <ul><li class="col-sm-12 col-md-12"><div class="input-group input-group-xs">
                    <input type="checkbox" id="hideConflict" class="form-control pull-left input-xs input-xs-last fixed">
                </div></li></ul>
            </div>
        </div>
    </div>`
  document.getElementsByClassName("condition-item")[0].appendChild(div2)
}

let loaded = false, warned = false
function initializeHandler() {
  if (!loaded) {
    for (let o of document.getElementsByClassName('outer_left')) {
      o.addEventListener('click', () => setTimeout(process, 1000))
      loaded = true
    }
  }
}

// 辅助函数：从 POST 数据中提取 filter_list
function extractFilterListFromRequest(request) {
  if (request.method !== 'POST') return null;
  let data = request.data;
  let contentType = request.headers && request.headers['Content-Type'];
  if (!data) return null;

  // 尝试解析 data
  let parsed = null;
  // 如果是字符串，先根据 Content-Type 转换
  if (typeof data === 'string') {
    if (contentType && contentType.includes('application/json')) {
      try { parsed = JSON.parse(data); } catch (e) { return null; }
    } else if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(data);
      const filterStr = params.get('filter_list[0]');
      if (filterStr) {
        try { return JSON.parse(filterStr); } catch (e) { return filterStr; }
      }
      return null;
    }
  } else if (data instanceof FormData) {
    const filterValue = data.get('filter_list');
    if (filterValue) {
      try { return JSON.parse(filterValue); } catch (e) { return filterValue; }
    }
    return null;
  } else if (typeof data === 'object') {
    // 假设是普通对象
    parsed = data;
  }
  // 如果 parsed 是对象，尝试取 filter_list 字段
  if (parsed && parsed.filter_list !== undefined) return parsed.filter_list;
  return null;
}

/**
 * 初始化并拦截 AJAX 请求，修改教师跳转逻辑并注入页面
 */
function initHooks() {
  //hoot for $.post
  ajaxHooker.hook(request => {
    // 只拦截 POST 请求，且 URL 包含上述特征
    if (request.method !== 'POST') return;
    const url = request.url;
    // 需要拦截的三个接口
    if (url.indexOf('zzxkyzb_cxXsXktsxx') !== -1 ||
      url.indexOf('zzxkyzb_cxZzxkYzbChoosedDisplay') !== -1 ||
      url.indexOf('zzxkyzbjk_cxJxbWithKchZzxkYzb') !== -1) {

      let filterList = null;
      if (url.indexOf('zzxkyzbjk_cxJxbWithKchZzxkYzb') !== -1) {
        filterList = extractFilterListFromRequest(request);
        if (filterList !== null) request._filterList = filterList;
      }

      // 拦截响应，在页面拿到数据后执行你的回调逻辑
      request.response = res => {
        let responseData = res.responseText;
        // 尝试解析为 JSON（原回调中 responseData 已经是解析后的对象）
        let parsedData = null;
        try { parsedData = JSON.parse(responseData); } catch (e) { parsedData = responseData; /* 非JSON时原样保留 */ }

        // 根据不同接口执行不同逻辑（完全对照你原 callback 里的代码）
        if (url.indexOf('zzxkyzb_cxXsXktsxx') !== -1) {
          setTimeout(initialize, 100);
        }
        else if (url.indexOf('zzxkyzb_cxZzxkYzbChoosedDisplay') !== -1) {
          rawData = parsedData;
        }
        else if (url.indexOf('zzxkyzbjk_cxJxbWithKchZzxkYzb') !== -1) {
          courseCache = parsedData;
          // 原回调中的延时处理（需要确保 DOM 存在，保留 500ms）
          setTimeout(() => {
            for (let { jxb_id, sksj, jsxx } of courseCache) {
              let obj = document.getElementById(`tr_${jxb_id}`);
              if (!obj) continue;

              // 【需求实现】修改原本系统的教师超链接，转跳到 rate 系统
              let teacherLinks = obj.querySelectorAll('.jsxmzc a');
              teacherLinks.forEach(link => {
                let tName = link.innerText.trim();
                if (tName) {
                  let searchUrl = `https://course-rate.icu/search?keyword=${encodeURIComponent(tName)}`;
                  link.href = searchUrl;
                  link.removeAttribute('target'); // 移除新建标签页属性
                  link.removeAttribute('onclick');
                  link.title = '点击查看教师评分';

                  // 绑定点击事件，弹出 500x700 的居中窗口
                  link.addEventListener('click', function (e) {
                    e.preventDefault(); // 阻止默认的链接跳转
                    e.stopPropagation(); // 阻止事件冒泡
                    let w = 500, h = 700;
                    let left = (window.screen.width - w) / 2;
                    let top = (window.screen.height - h) / 2;
                    window.open(searchUrl, 'ratePopup_teacher_' + encodeURIComponent(tName), `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
                  });
                }
              });

              injectRateEmoji(obj.getElementsByClassName('xkbz')?.[0], filterList, obj.getElementsByClassName('jsxm')?.[0].innerText).catch(console.log)

              // 教师筛选
              let teacherFilter = document.getElementById('teacherFilter')?.value || '';
              if (jsxx.indexOf(teacherFilter) === -1) obj.hidden = true;

              // 冲突检测
              let hideConflict = document.getElementById('hideConflict')?.checked || false;
              if (tableCache) {
                let conflict = false;
                for (let t of sksj.split('<br/>')) {
                  if (checkConflict(tableCache, t)) { conflict = true; break; }
                }
                if (conflict) {
                  if (hideConflict) obj.hidden = true;
                  else obj.style.backgroundColor = 'lightpink';
                }
              } else if (hideConflict && !warned) {
                alert('课表未缓存，无法显示冲突信息！\n请打开右侧课表栏等待加载完再重新查询');
                warned = true;
              }

              // 预览所选课程（鼠标悬浮）
              obj.addEventListener('mouseenter', _ => {
                if (!tableCache) return;
                let tempTable = structuredClone(tableCache);
                for (let t of sksj.split('<br/>')) fillTime(t, 'mediumpurple', tempTable);
                drawTable(tempTable);
              });
              obj.addEventListener('mouseleave', _ => {
                if (!tableCache) return;
                drawTable(tableCache);
              });
            }
          }, 500);
        }
      };
    }
  });
}

(function () {
  'use strict'
  console.log('script called')
  initHooks()

  //initialize
  let checkAttempts = 0;
  let skipInterval = setInterval(() => {
    let yd = document.getElementById('btn_yd')
    if (yd != null && typeof initXz === 'function') {
      initXz()
      yd.click()
      clearInterval(skipInterval)
    }
    if (++checkAttempts > 10) {
      clearInterval(skipInterval);
    }
  }, 100)

  document.addEventListener('click', initializeHandler)
})()