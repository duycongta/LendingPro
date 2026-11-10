/* LendingPro – đọc file sao kê LD23 (xlsx) và gom theo Hợp đồng chính */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.LendData = factory(root.LendCalc);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  /* Cột theo tên tiêu đề (khớp với các cột B, D, E, G, H, I, M, N, O, R, AF, AT, AU, BG, BH mà người dùng yêu cầu).
     Dùng tên tiêu đề để vẫn chạy đúng nếu thêm/bớt cột; nếu không tìm thấy thì rơi về chỉ số cột cố định. */
  var COLS = {
    contract:  ['Hợp đồng', 0],
    main:      ['Hợp đồng chính', 1],
    module:    ['Phân hệ', 2],
    custId:    ['Mã khách hàng', 3],
    custName:  ['Tên khách hàng', 4],
    currency:  ['Loại tiền', 5],
    openDate:  ['Ngày mở', 6],
    maturity:  ['Ngày đáo hạn', 7],
    rate:      ['Lãi suất', 8],
    term:      ['Kì hạn', 12],
    termName:  ['Tên kì hạn', 13],
    principal: ['Gốc vay', 14],
    due:       ['Gốc phải trả', 15],
    paid:      ['Gốc đã trả', 16],
    balance:   ['Gốc còn lại', 17],
    interestLeft: ['Lãi còn lại', 20],
    debtGroup: ['Nhóm nợ', 24],
    branch:    ['Tên chi nhánh', 27],
    product:   ['Tên sản phẩm', 31],
    portCode:  ['Mã portfolio', 45],
    portName:  ['User T24 CRO', 46],
    saleId:    ['Cán bộ bán', 58],
    saleName:  ['Tên cán bộ bán', 59]
  };

  function findHeaderRow(aoa) {
    for (var i = 0; i < Math.min(aoa.length, 30); i++) {
      var row = aoa[i] || [];
      for (var j = 0; j < row.length; j++) if (String(row[j]).trim() === 'Hợp đồng chính') return i;
    }
    return -1;
  }
  function str(v) { return v == null ? '' : String(v).trim(); }
  function num(v) { if (v == null || v === '') return 0; var n = +v; return isFinite(n) ? n : 0; }
  function toISO(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return C.excelSerialToISO(v);
    var s = String(v).trim(), m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  }
  /** "Ngày báo cáo: 09/11/2026" nằm trong vài dòng đầu. */
  function findReportDate(aoa) {
    for (var i = 0; i < Math.min(aoa.length, 8); i++) {
      var m = String((aoa[i] || [])[0] || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    }
    return null;
  }

  function toRecord(row, idx) {
    function g(k) { return row[idx[k]]; }
    return {
      contract: str(g('contract')), main: str(g('main')), module: str(g('module')),
      custId: str(g('custId')), custName: str(g('custName')), currency: str(g('currency')) || 'VND',
      openDate: toISO(g('openDate')), maturityDate: toISO(g('maturity')),
      rate: num(g('rate')), term: str(g('term')), termName: str(g('termName')),
      principal: num(g('principal')), due: num(g('due')), paid: num(g('paid')), balance: num(g('balance')),
      interestLeft: num(g('interestLeft')), debtGroup: str(g('debtGroup')), branch: str(g('branch')),
      product: str(g('product')), portCode: str(g('portCode')), portName: str(g('portName')),
      saleId: str(g('saleId')), saleName: str(g('saleName'))
    };
  }

  /** Từ mảng 2 chiều (sheet_to_json header:1) → { loans, reportDate }. */
  function parseRows(aoa) {
    var h = findHeaderRow(aoa);
    if (h < 0) throw new Error('Không tìm thấy dòng tiêu đề (cột "Hợp đồng chính"). Đây có phải file LD23 – Sao kê tín dụng không?');
    var headers = (aoa[h] || []).map(str), idx = {};
    Object.keys(COLS).forEach(function (k) {
      var at = headers.indexOf(COLS[k][0]);
      idx[k] = at >= 0 ? at : COLS[k][1];
    });
    var groups = {}, order = [];
    for (var i = h + 1; i < aoa.length; i++) {
      var row = aoa[i];
      if (!row || row[idx.main] == null || row[idx.main] === '') continue;
      var rec = toRecord(row, idx);
      if (!groups[rec.main]) { groups[rec.main] = []; order.push(rec.main); }
      groups[rec.main].push(rec);
    }
    var loans = order.map(function (id) {
      var rs = groups[id];
      var primary = rs.filter(function (r) { return r.contract === id; })[0] ||
                    rs.filter(function (r) { return r.module !== 'PD'; })[0] || rs[0];
      var related = rs.filter(function (r) { return r !== primary; });
      var loan = Object.assign({}, primary, { id: id, related: related });
      loan.relatedBalance = related.reduce(function (s, r) { return s + r.balance; }, 0);
      loan.search = C.normalize([id, loan.custId, loan.custName].join(' '));
      return loan;
    });
    return { loans: loans, reportDate: findReportDate(aoa), rowCount: aoa.length - h - 1 };
  }

  /** Đọc workbook bằng SheetJS (XLSX truyền vào để dùng được cả trình duyệt lẫn Node). */
  function parseWorkbook(XLSX, data) {
    var wb = XLSX.read(data, { type: 'array', dense: true });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    return parseRows(aoa);
  }


  /* ---------- File "Lịch trả nợ tháng" (số liệu chính thức từ hệ thống) ---------- */
  var SCOLS = {
    tk:    ['Số tài khoản của Khách hàng (TK)', 1], custId: ['ID KH', 4], goc: ['Số tiền gốc', 5], lai: ['Số tiền lãi', 6],
    due:   ['Ngày đến hạn thanh toán', 7], fee: ['Phí bảo hiểm', 8], tot: ['Tổng số tiền phải thanh toán', 9],
    open:  ['Ngày mở', 19], bal: ['Gốc còn lại', 20], vay: ['Gốc vay', 21], contract: ['CONTRACT', 22], odDays: ['Số ngày QH', 13]
  };
  function findScheduleHeader(aoa) {
    for (var i = 0; i < Math.min(aoa.length, 30); i++) {
      var row = (aoa[i] || []).map(str);
      if (row.indexOf('Ngày đến hạn thanh toán') >= 0 && row.indexOf('Số tiền gốc') >= 0) return i;
    }
    return -1;
  }
  function parseSchedule(aoa) {
    var h = findScheduleHeader(aoa);
    if (h < 0) throw new Error('Không nhận ra file lịch trả nợ.');
    var headers = aoa[h].map(str), idx = {};
    Object.keys(SCOLS).forEach(function (k) { var at = headers.indexOf(SCOLS[k][0]); idx[k] = at >= 0 ? at : SCOLS[k][1]; });
    var rows = [], months = {};
    for (var i = h + 1; i < aoa.length; i++) {
      var r = aoa[i];
      if (!r || !str(r[idx.tk])) continue;
      var due = toISO(r[idx.due]);
      if (!due) continue;
      rows.push({ tk: str(r[idx.tk]), custId: str(r[idx.custId]), open: toISO(r[idx.open]), vay: num(r[idx.vay]), bal: num(r[idx.bal]),
                  odDays: Math.max(0, parseInt(r[idx.odDays], 10) || 0), contract: headers.indexOf('CONTRACT') >= 0 ? str(r[idx.contract]) : '', due: due, goc: num(r[idx.goc]), lai: num(r[idx.lai]), fee: num(r[idx.fee]), tot: num(r[idx.tot]) });
      months[due.slice(0, 7)] = (months[due.slice(0, 7)] || 0) + 1;
    }
    var month = Object.keys(months).sort(function (a, b) { return months[b] - months[a]; })[0] || '';
    return { rows: rows, month: month };
  }
  /** Ghép dòng lịch với hợp đồng LD23 → { mã HĐ chính: dòng lịch }.
   *  Ưu tiên cột CONTRACT (chính xác); dòng nào không ghép được thì dùng ID KH + ngày mở + gốc vay. */
  function matchSchedule(loans, rows) {
    var out = {}, used = {}, byC = {};
    rows.forEach(function (r, i) { if (r.contract) byC[r.contract] = i; });
    loans.forEach(function (l) {
      var ids = [l.id, l.contract].concat((l.related || []).map(function (x) { return x.contract; }));
      for (var k = 0; k < ids.length; k++) {
        var i = byC[ids[k]];
        if (i != null && !used[i]) { out[l.id] = rows[i]; used[i] = 1; break; }
      }
    });
    var q = {};
    rows.forEach(function (r, i) {
      if (used[i]) return;
      var key = r.custId + '|' + r.open + '|' + r.vay;
      (q[key] = q[key] || []).push(i);
    });
    loans.forEach(function (l) {
      if (out[l.id]) return;
      var list = q[l.custId + '|' + l.openDate + '|' + l.principal];
      if (list && list.length) { var i = list.shift(); out[l.id] = rows[i]; used[i] = 1; }
    });
    return out;
  }
  /** Nhận diện loại file: lịch trả nợ hay sao kê LD23. */
  function parseAny(XLSX, data) {
    var wb = XLSX.read(data, { type: 'array', dense: true });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    if (findScheduleHeader(aoa) >= 0) return Object.assign({ kind: 'schedule' }, parseSchedule(aoa));
    return Object.assign({ kind: 'loans' }, parseRows(aoa));
  }

  return { parseRows: parseRows, parseWorkbook: parseWorkbook, parseSchedule: parseSchedule, matchSchedule: matchSchedule, parseAny: parseAny };
});
