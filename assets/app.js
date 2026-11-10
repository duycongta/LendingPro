/* LendingPro – giao diện tra cứu */
(function () {
  'use strict';
  var C = window.LendCalc, D = window.LendData, CFG = window.LP_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var PAGE = 60;

  var state = { loans: [], byId: {}, reportDate: null, fileName: '', query: '', onlyActive: false,
                shown: PAGE, results: [], selected: null, method: 'equal', showAll: false };

  /* ---------- tiện ích ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var nf0 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
  var nf2 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
  function money(v, cur) {
    if (v == null || isNaN(v)) return '—';
    return cur && cur !== 'VND' ? nf2.format(v) + ' ' + cur : nf0.format(Math.round(v)) + ' ₫';
  }
  function moneyShort(v, cur) {
    if (cur && cur !== 'VND') return nf2.format(v) + ' ' + cur;
    var a = Math.abs(v);
    if (a >= 1e9) return nf2.format(v / 1e9) + ' tỷ';
    if (a >= 1e6) return nf2.format(v / 1e6) + ' tr';
    return nf0.format(v) + ' ₫';
  }
  function fdate(iso) { if (!iso) return '—'; var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function pct(v) { return nf2.format(v) + '%'; }
  var DEBT = { '1': 'Nhóm 1 – Đủ tiêu chuẩn', '2': 'Nhóm 2 – Cần chú ý', '3': 'Nhóm 3 – Dưới tiêu chuẩn',
               '4': 'Nhóm 4 – Nghi ngờ', '5': 'Nhóm 5 – Có khả năng mất vốn' };
  function show(el, on) { el.hidden = !on; }
  function busy(on, text) { show($('busy'), on); if (text) $('busy-text').textContent = text; }

  /* ---------- lưu dữ liệu trên trình duyệt (IndexedDB) ---------- */
  var DB = {
    open: function () {
      return new Promise(function (res, rej) {
        try {
          var rq = indexedDB.open('lendingpro', 1);
          rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
          rq.onsuccess = function () { res(rq.result); };
          rq.onerror = function () { rej(rq.error); };
        } catch (e) { rej(e); }
      });
    },
    get: function () {
      return DB.open().then(function (db) {
        return new Promise(function (res) {
          var rq = db.transaction('kv').objectStore('kv').get('data');
          rq.onsuccess = function () { res(rq.result || null); };
          rq.onerror = function () { res(null); };
        });
      }).catch(function () { return null; });
    },
    set: function (val) {
      return DB.open().then(function (db) {
        return new Promise(function (res) {
          var tx = db.transaction('kv', 'readwrite');
          if (val) tx.objectStore('kv').put(val, 'data'); else tx.objectStore('kv').delete('data');
          tx.oncomplete = function () { res(true); };
          tx.onerror = function () { res(false); };
        });
      }).catch(function () { return false; });
    }
  };

  /* ---------- nạp dữ liệu ---------- */
  function setData(payload) {
    state.loans = payload.loans;
    state.reportDate = payload.reportDate || new Date().toISOString().slice(0, 10);
    state.fileName = payload.fileName || '';
    state.updatedAt = payload.updatedAt || '';
    state.byId = {};
    state.loans.forEach(function (l) { if (!l.search) l.search = C.normalize([l.id, l.custId, l.custName].join(' ')); state.byId[l.id] = l; });
    state.selected = null;
    show($('welcome'), false); show($('workspace'), true);
    $('q').disabled = false;
    renderStatus();
    runSearch();
    routeFromHash();
  }

  function loadFile(file) {
    if (!file) return;
    busy(true, 'Đang đọc ' + file.name + '…');
    var rd = new FileReader();
    rd.onerror = function () { busy(false); fail('Không đọc được file.'); };
    rd.onload = function () {
      // nhường một nhịp cho trình duyệt vẽ màn hình chờ
      setTimeout(function () {
        try {
          var parsed = D.parseWorkbook(window.XLSX, new Uint8Array(rd.result));
          if (!parsed.loans.length) throw new Error('File không có dòng dữ liệu nào.');
          parsed.fileName = file.name;
          parsed.updatedAt = new Date().toISOString();
          setData(parsed);
          DB.set(parsed);
          pushRemote(parsed);
        } catch (e) { fail(e.message || String(e)); }
        busy(false);
      }, 30);
    };
    rd.readAsArrayBuffer(file);
  }
  function fail(msg) {
    var box = $('welcome-error');
    box.textContent = '⚠ ' + msg; show(box, true);
    if (state.loans.length) alert(msg); else { show($('welcome'), true); show($('workspace'), false); }
  }

  /* ---------- đồng bộ GitHub ---------- */
  var toastTimer;
  function toast(msg, err) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); show(t, true);
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { show(t, false); }, err ? 7000 : 3500);
  }
  function getToken() { try { return localStorage.getItem('lp_token') || ''; } catch (e) { return ''; } }
  function apiUrl() { return 'https://api.github.com/repos/' + CFG.owner + '/' + CFG.repo + '/contents/' + CFG.path; }
  function authHeaders(extra) {
    var h = Object.assign({ 'X-GitHub-Api-Version': '2022-11-28' }, extra || {}), t = getToken();
    if (t) h.Authorization = 'Bearer ' + t;
    return h;
  }
  function fetchRemote() {
    // API (luôn mới nhất) → file tĩnh trên Pages/localhost (có thể bị cache vài phút)
    return fetch(apiUrl() + '?ref=' + CFG.branch, { headers: authHeaders({ Accept: 'application/vnd.github.raw+json' }), cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .catch(function () { return fetch(CFG.path + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }); })
      .then(function (j) { if (!j || !j.loans || !j.loans.length) throw 0; return j; });
  }
  function toBase64(str) {
    var bytes = new TextEncoder().encode(str), bin = '', i, CH = 0x8000;
    for (i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }
  function pushRemote(parsed) {
    if (!getToken()) { toast('Đã nạp dữ liệu trên thiết bị này. Thêm token ở ⚙ để cập nhật lên GitHub.'); return; }
    busy(true, 'Đang cập nhật dữ liệu lên GitHub…');
    var slim = { reportDate: parsed.reportDate, fileName: parsed.fileName, updatedAt: parsed.updatedAt,
      loans: parsed.loans.map(function (l) { var c = Object.assign({}, l); delete c.search; return c; }) };
    fetch(apiUrl() + '?ref=' + CFG.branch, { headers: authHeaders({ Accept: 'application/vnd.github+json' }), cache: 'no-store' })
      .then(function (r) { return r.status === 404 ? null : r.ok ? r.json() : r.json().then(function (j) { throw new Error(j.message || r.status); }); })
      .then(function (meta) {
        var body = { message: 'Cập nhật dữ liệu LD23 ngày ' + fdate(parsed.reportDate) + ' (' + parsed.loans.length + ' HĐ)',
                     content: toBase64(JSON.stringify(slim)), branch: CFG.branch };
        if (meta && meta.sha) body.sha = meta.sha;
        return fetch(apiUrl(), { method: 'PUT', headers: authHeaders({ Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
      })
      .then(function (r) { if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || r.status); }); toast('✓ Đã cập nhật dữ liệu mới lên GitHub'); })
      .catch(function (e) { toast('Không cập nhật được lên GitHub: ' + (e.message || e) + '. Dữ liệu vẫn dùng được trên thiết bị này.', true); })
      .then(function () { busy(false); });
  }

  /* ---------- tìm kiếm ---------- */
  function runSearch() {
    var raw = state.query.trim(), q = C.normalize(raw);
    var tokens = q ? q.split(' ') : [];
    var out;
    if (!tokens.length) {
      out = state.loans.slice();
    } else {
      out = state.loans.filter(function (l) {
        return tokens.every(function (t) { return l.search.indexOf(t) >= 0; });
      });
    }
    if (state.onlyActive) out = out.filter(function (l) { return l.balance > 0 || l.relatedBalance > 0; });
    var exact = q;
    out.sort(function (a, b) {
      var ea = (a.custId === exact || a.id === exact) ? 1 : 0, eb = (b.custId === exact || b.id === exact) ? 1 : 0;
      if (ea !== eb) return eb - ea;
      return (b.balance + b.relatedBalance) - (a.balance + a.relatedBalance);
    });
    state.results = out; state.shown = PAGE;
    renderList();
  }

  /* ---------- hiển thị danh sách ---------- */
  function statusOf(l) {
    var p = C.paymentSummary(l, state.reportDate, { method: state.method });
    var open = l.balance > 0 || l.relatedBalance > 0;
    if (!open) return { cls: 'gray', text: 'Đã tất toán', p: p };
    if (p.pastMaturity) return { cls: 'red', text: 'Quá hạn ' + p.overdueDays + ' ngày', p: p };
    if (parseInt(l.debtGroup, 10) >= 2) return { cls: 'amber', text: 'Nhóm nợ ' + l.debtGroup, p: p };
    return { cls: 'green', text: 'Đang vay', p: p };
  }

  function renderStatus() {
    $('status-line').innerHTML =
      '<span class="dot"></span>' + (state.fileName ? '<b>' + esc(state.fileName) + '</b> · ' : '') + (state.updatedAt ? 'cập nhật ' + esc(state.updatedAt.replace('T', ' ').slice(0, 16)) + ' · ' : '') +
      'Ngày báo cáo <b>' + fdate(state.reportDate) + '</b> · ' + nf0.format(state.loans.length) + ' hợp đồng';
  }

  function renderList() {
    var res = state.results, list = $('results');
    var cust = {};
    res.forEach(function (l) { cust[l.custId] = 1; });
    var nc = Object.keys(cust).length, summary;
    if (!res.length) summary = 'Không tìm thấy';
    else if (nc === 1 && state.query.trim()) {
      var tot = res.reduce(function (s, l) { return s + l.balance; }, 0), cur = res[0].currency;
      summary = '<b>' + esc(res[0].custName) + '</b> · ' + res.length + ' khoản · Dư nợ ' + moneyShort(tot, cur);
    } else summary = nf0.format(res.length) + ' hợp đồng' + (state.query.trim() ? ' · ' + nc + ' khách hàng' : '');
    $('summary').innerHTML = summary;

    if (!res.length) {
      list.innerHTML = '<li class="empty"><div class="empty-art">🔎</div><b>Không có kết quả</b>' +
        '<span>Thử nhập ít từ hơn, bỏ dấu, hoặc kiểm tra lại ID khách hàng / mã hợp đồng.</span></li>';
      show($('more'), false);
      return;
    }
    var html = '';
    res.slice(0, state.shown).forEach(function (l) {
      var st = statusOf(l);
      html += '<li><button type="button" class="item' + (l.id === state.selected ? ' active' : '') + '" data-id="' + esc(l.id) + '">' +
        '<span class="avatar">' + esc(initials(l.custName)) + '</span>' +
        '<span class="item-main"><span class="item-name">' + esc(l.custName) + '</span>' +
        '<span class="item-sub">' + esc(l.custId) + ' · ' + esc(l.id) + '</span>' +
        '<span class="item-sub">' + esc(l.product || '—') + '</span></span>' +
        '<span class="item-side"><span class="item-amt">' + moneyShort(l.balance, l.currency) + '</span>' +
        '<span class="badge ' + st.cls + '">' + esc(st.text) + '</span></span></button></li>';
    });
    list.innerHTML = html;
    var rest = res.length - state.shown;
    show($('more'), rest > 0);
    if (rest > 0) $('more').textContent = 'Xem thêm ' + Math.min(rest, PAGE) + ' / còn ' + nf0.format(rest) + ' kết quả';
  }
  function initials(name) {
    var p = String(name || '?').trim().split(/\s+/);
    return ((p[p.length - 2] || '').charAt(0) + p[p.length - 1].charAt(0)).toUpperCase() || '?';
  }

  /* ---------- chi tiết khoản vay ---------- */
  function kv(label, value, cls) {
    return '<div class="kv ' + (cls || '') + '"><dt>' + label + '</dt><dd>' + (value === '' || value == null ? '—' : value) + '</dd></div>';
  }

  function renderDetail(l) {
    var cur = l.currency, st = statusOf(l), p = st.p, sch = p.schedule;
    var repaid = l.principal > 0 ? Math.max(0, Math.min(100, (l.principal - l.balance) / l.principal * 100)) : 0;
    var kind = sch.kind, closed = !(l.balance > 0);
    var kindText = kind === 'short' ? 'Trả lãi hàng tháng, gốc trả cuối kỳ' : 'Trả gốc + lãi hàng tháng theo dư nợ giảm dần';
    var h = '';

    h += '<button type="button" class="back" id="back"><svg viewBox="0 0 24 24"><path d="M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z"/></svg> Danh sách</button>';
    h += '<header class="d-head"><span class="avatar lg">' + esc(initials(l.custName)) + '</span><div class="d-title">' +
      '<h2>' + esc(l.custName) + '</h2><p>ID KH <b>' + esc(l.custId) + '</b> · HĐ <b>' + esc(l.id) + '</b></p></div>' +
      '<span class="badge lg ' + st.cls + '">' + esc(st.text) + '</span></header>';

    h += '<div class="stats">' +
      '<div class="stat"><span>Số tiền vay</span><b>' + money(l.principal, cur) + '</b></div>' +
      '<div class="stat accent"><span>Gốc còn lại</span><b>' + money(l.balance, cur) + '</b>' +
      '<div class="bar" role="img" aria-label="Đã trả ' + nf0.format(repaid) + '% gốc"><i style="width:' + repaid.toFixed(1) + '%"></i></div>' +
      '<small>Đã trả ' + nf0.format(repaid) + '% gốc</small></div>' +
      '<div class="stat"><span>Lãi suất</span><b>' + pct(l.rate) + '<em>/năm</em></b></div>' +
      '<div class="stat"><span>Kỳ hạn</span><b>' + (sch.months ? sch.months + ' tháng' : '—') + '</b><small>' + esc(C.termLabel(l.termName)) +
      (sch.derived ? ' · suy ra từ ngày mở/đáo hạn' : '') + '</small></div></div>';

    // Số tiền phải trả hàng tháng
    h += '<section class="card pay"><h3>Số tiền phải trả hàng tháng</h3>';
    if (!sch.rows.length) {
      h += '<p class="muted">Hợp đồng không có kỳ hạn / ngày đáo hạn rõ ràng (thẻ, hạn mức, thấu chi…) nên chưa tính được lịch trả nợ.</p>';
    } else if (closed) {
      h += '<p class="muted">Hợp đồng không còn dư nợ gốc – không phát sinh khoản phải trả.</p>';
    } else if (p.pastMaturity) {
      h += '<p class="warn">Đã quá ngày đáo hạn ' + fdate(l.maturityDate) + ' (' + p.overdueDays + ' ngày) mà vẫn còn dư nợ gốc <b>' + money(l.balance, cur) + '</b>.</p>';
    } else {
      h += '<div class="pay-main"><div><span class="lbl">Kỳ tới · ' + fdate(p.nextDate) + (p.isFinalPeriod ? ' (kỳ cuối)' : '') + '</span>' +
        '<div class="big">' + money(p.nextTotal, cur) + '</div></div>' +
        '<div class="pay-split"><div><span>Gốc</span><b>' + money(p.nextPrincipal, cur) + '</b></div>' +
        '<div><span>Lãi</span><b>' + money(p.nextInterest, cur) + '</b></div></div></div>';
      h += '<p class="muted">' + kindText + '. Còn <b>' + p.remainingPeriods + '</b> kỳ trả. ' +
        (kind === 'short' ? 'Mỗi tháng chỉ trả lãi, đến ' + fdate(l.maturityDate || sch.rows[sch.rows.length - 1].date) + ' trả thêm gốc <b>' + money(l.balance, cur) + '</b>.' : '') + '</p>';
    }
    if (sch.rows.length && kind === 'amortizing') {
      h += '<div class="seg" role="group" aria-label="Cách tính"><button type="button" data-method="equal" class="' + (state.method === 'equal' ? 'on' : '') + '">Gốc đều, lãi giảm dần</button>' +
        '<button type="button" data-method="annuity" class="' + (state.method === 'annuity' ? 'on' : '') + '">Tổng trả đều (niên kim)</button></div>';
    }
    h += '</section>';

    // Thông tin chung
    h += '<section class="card"><h3>Thông tin khoản vay</h3><dl class="grid">' +
      kv('Mã HĐ chính', esc(l.id)) + kv('ID khách hàng', esc(l.custId)) +
      kv('Ngày vay (ngày mở)', fdate(l.openDate)) + kv('Ngày kết thúc', fdate(l.maturityDate)) +
      kv('Sản phẩm', esc(l.product), 'wide') +
      kv('Mã Port', esc(l.portCode)) + kv('Tên Port', esc(l.portName)) +
      kv('Sale ID', esc(l.saleId)) + kv('Tên cán bộ bán', esc(l.saleName)) +
      kv('Nhóm nợ', esc(DEBT[l.debtGroup] || l.debtGroup), 'wide') +
      (l.branch ? kv('Chi nhánh', esc(l.branch), 'wide') : '') + '</dl></section>';

    // Khoản liên quan (PD…)
    if (l.related.length) {
      h += '<section class="card"><h3>Khoản liên quan (' + l.related.length + ')</h3><div class="rel">';
      l.related.forEach(function (r) {
        h += '<div class="rel-row"><div><b>' + esc(r.contract) + '</b><small>' + esc(r.module) + ' · mở ' + fdate(r.openDate) + ' · nhóm nợ ' + esc(r.debtGroup) + '</small></div>' +
          '<div class="rel-amt"><b>' + money(r.balance, r.currency) + '</b><small>gốc còn lại / vay ' + moneyShort(r.principal, r.currency) + '</small></div></div>';
      });
      h += '</div><p class="muted small">Các khoản này (thường là phân hệ PD – chuyển nợ/quá hạn/trả góp) là dòng riêng trong sao kê, không cộng vào “Gốc còn lại” của hợp đồng chính ở trên.</p></section>';
    }

    // Lịch trả nợ
    if (sch.rows.length) {
      var rows = sch.rows, many = rows.length > 14 && !state.showAll;
      var next = p.nextRow ? p.nextRow.no : 0;
      var vis = rows;
      if (many) {
        vis = rows.filter(function (x) { return x.no <= 3 || (next && Math.abs(x.no - next) <= 4) || x.no > rows.length - 2; });
      }
      h += '<section class="card"><div class="card-h"><h3>Lịch trả nợ theo hợp đồng</h3><span class="muted small">Tính trên số tiền vay ban đầu</span></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Kỳ</th><th>Ngày</th><th class="num hide-s">Dư nợ đầu kỳ</th><th class="num">Gốc</th><th class="num">Lãi</th><th class="num">Tổng trả</th></tr></thead><tbody>';
      var last = 0;
      vis.forEach(function (x) {
        if (last && x.no - last > 1) h += '<tr class="gap"><td colspan="6">⋯ ' + (x.no - last - 1) + ' kỳ ẩn ⋯</td></tr>';
        last = x.no;
        var cls = x.date < state.reportDate ? 'past' : (x.no === next ? 'next' : '');
        h += '<tr class="' + cls + '"><td>' + x.no + '</td><td>' + fdate(x.date) + '</td><td class="num hide-s">' + nf0.format(x.opening) +
          '</td><td class="num">' + nf0.format(x.principal) + '</td><td class="num">' + nf0.format(x.interest) +
          '</td><td class="num"><b>' + nf0.format(x.total) + '</b></td></tr>';
      });
      var sp = rows.reduce(function (s, x) { return s + x.principal; }, 0), si = rows.reduce(function (s, x) { return s + x.interest; }, 0);
      h += '</tbody><tfoot><tr><td colspan="2">Tổng</td><td class="hide-s"></td><td class="num">' + nf0.format(sp) + '</td><td class="num">' + nf0.format(si) +
        '</td><td class="num">' + nf0.format(sp + si) + '</td></tr></tfoot></table></div>';
      if (rows.length > 14) h += '<button type="button" class="btn ghost" id="toggle-all">' + (state.showAll ? 'Thu gọn' : 'Hiện đủ ' + rows.length + ' kỳ') + '</button>';
      h += '<p class="muted small">Lãi mỗi kỳ = dư nợ đầu kỳ × lãi suất năm ÷ 12 (làm tròn khi hiển thị). Số liệu mang tính tham khảo, không thay thế sao kê chính thức của ngân hàng; lãi thực tế có thể khác do cách tính số ngày, lãi suất thả nổi hoặc phí.</p></section>';
    }
    $('detail').innerHTML = h;
  }

  function select(id, push) {
    var l = state.byId[id];
    if (!l) return;
    state.selected = id; state.showAll = false;
    renderDetail(l);
    show($('placeholder'), false); show($('detail'), true);
    document.body.classList.add('detail-open');
    $('detail-pane').scrollTop = 0; window.scrollTo(0, 0);
    Array.prototype.forEach.call(document.querySelectorAll('.item'), function (b) { b.classList.toggle('active', b.dataset.id === id); });
    if (push !== false && location.hash !== '#hd=' + id) location.hash = 'hd=' + encodeURIComponent(id);
  }
  function closeDetail() {
    state.selected = null;
    document.body.classList.remove('detail-open');
    show($('detail'), false); show($('placeholder'), true);
    Array.prototype.forEach.call(document.querySelectorAll('.item.active'), function (b) { b.classList.remove('active'); });
  }
  function routeFromHash() {
    var m = location.hash.match(/^#hd=(.+)$/);
    if (m && state.byId[decodeURIComponent(m[1])]) select(decodeURIComponent(m[1]), false);
    else if (state.selected) closeDetail();
  }

  /* ---------- sự kiện ---------- */
  var timer;
  $('q').addEventListener('input', function (e) {
    state.query = e.target.value; show($('clear'), !!state.query);
    clearTimeout(timer); timer = setTimeout(runSearch, 120);
  });
  $('q').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && state.results.length) { e.preventDefault(); select(state.results[0].id); e.target.blur(); }
  });
  $('clear').addEventListener('click', function () { $('q').value = ''; state.query = ''; show($('clear'), false); runSearch(); $('q').focus(); });
  $('only-active').addEventListener('change', function (e) { state.onlyActive = e.target.checked; runSearch(); });
  $('more').addEventListener('click', function () { state.shown += PAGE; renderList(); });
  $('results').addEventListener('click', function (e) {
    var b = e.target.closest('.item'); if (b) select(b.dataset.id);
  });
  $('detail').addEventListener('click', function (e) {
    if (e.target.closest('#back')) { if (location.hash) history.back(); else closeDetail(); return; }
    var m = e.target.closest('[data-method]');
    if (m) { state.method = m.dataset.method; renderDetail(state.byId[state.selected]); renderList(); return; }
    if (e.target.closest('#toggle-all')) { state.showAll = !state.showAll; renderDetail(state.byId[state.selected]); }
  });
  window.addEventListener('hashchange', routeFromHash);
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== $('q') && !$('q').disabled) { e.preventDefault(); $('q').focus(); }
    if (e.key === 'Escape' && document.body.classList.contains('detail-open') && document.activeElement !== $('q')) { if (location.hash) history.back(); else closeDetail(); }
  });

  var fileInput = $('file');
  ['load-btn', 'pick-btn'].forEach(function (id) { $(id).addEventListener('click', function (e) { e.stopPropagation(); fileInput.click(); }); });
  $('drop').addEventListener('click', function () { fileInput.click(); });
  $('drop').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', function () { loadFile(fileInput.files[0]); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); document.body.classList.add('dragging'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement || !e.relatedTarget) document.body.classList.remove('dragging'); }); });
  document.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });

  var dlg = $('settings');
  $('settings-btn').addEventListener('click', function () {
    $('token').value = getToken(); $('settings-msg').textContent = getToken() ? 'Đã có token trên thiết bị này.' : 'Chưa có token – chỉ tra cứu được, chưa cập nhật lên GitHub.';
    dlg.showModal();
  });
  dlg.addEventListener('close', function () {
    if (dlg.returnValue === 'ok') { try { localStorage.setItem('lp_token', $('token').value.trim()); } catch (e) {} toast('Đã lưu token'); }
  });
  $('token-clear').addEventListener('click', function () { try { localStorage.removeItem('lp_token'); } catch (e) {} $('token').value = ''; $('settings-msg').textContent = 'Đã xóa token.'; });

  /* ---------- khởi động ---------- */
  // 1) data/loans.json mới nhất trên GitHub; 2) bản đã lưu trong trình duyệt; 3) màn hình nạp file
  fetchRemote().then(setData).catch(function () {
    return DB.get().then(function (saved) {
      if (saved && saved.loans && saved.loans.length) setData(saved); else show($('welcome'), true);
    });
  });
})();
