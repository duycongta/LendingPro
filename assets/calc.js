/* LendingPro – logic tính toán khoản vay (không phụ thuộc DOM, chạy được cả Node để test) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LendCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Ngày tháng (lưu dạng 'YYYY-MM-DD' để tránh lệch múi giờ) ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); } // m: 1-12
  function parseISO(s) {
    if (!s) return null;
    var p = String(s).split('-');
    return { y: +p[0], m: +p[1], d: +p[2] };
  }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  /** Cộng n tháng, nếu ngày không tồn tại thì lùi về cuối tháng (31/01 + 1 tháng = 28/02). */
  function addMonths(iso, n) {
    var p = parseISO(iso);
    var total = p.y * 12 + (p.m - 1) + n;
    var y = Math.floor(total / 12), m = (total % 12) + 1;
    return ymd(y, m, Math.min(p.d, daysInMonth(y, m)));
  }
  function dayNum(iso) { var p = parseISO(iso); return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000); }
  function diffDays(a, b) { return dayNum(a) - dayNum(b); }
  function excelSerialToISO(n) {
    var ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
    var d = new Date(ms);
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  /* ---------- Phân loại & kỳ hạn ---------- */
  /** NGANHAN → 'short' (trả lãi hàng tháng, gốc cuối kỳ); TRUNGHAN/DAIHAN → 'amortizing' (gốc + lãi theo dư nợ giảm dần). */
  function loanKind(termName) {
    var t = String(termName || '').toUpperCase().replace(/\s+/g, '');
    if (t === 'TRUNGHAN' || t === 'DAIHAN') return 'amortizing';
    return 'short';
  }
  var TERM_LABEL = { NGANHAN: 'Ngắn hạn', TRUNGHAN: 'Trung hạn', DAIHAN: 'Dài hạn' };
  function termLabel(termName) {
    return TERM_LABEL[String(termName || '').toUpperCase().replace(/\s+/g, '')] || (termName || '—');
  }
  /** Số tháng của kỳ hạn: ưu tiên cột Kì hạn; nếu trống/0 thì suy ra từ ngày mở – ngày đáo hạn. */
  function termMonths(loan) {
    var m = parseInt(loan.term, 10);
    if (m > 0) return { months: m, derived: false };
    if (loan.openDate && loan.maturityDate) {
      var days = diffDays(loan.maturityDate, loan.openDate);
      var est = Math.round(days / 30.4375);
      if (est > 0) return { months: est, derived: true };
    }
    return { months: 0, derived: false };
  }

  /* ---------- Lịch trả nợ ---------- */
  /**
   * Lịch trả nợ theo hợp đồng (tính trên Gốc vay ban đầu).
   *  - short:      mỗi kỳ chỉ trả lãi = dư nợ × lãi suất/12; kỳ cuối trả thêm toàn bộ gốc.
   *  - amortizing: method 'equal' (mặc định) → gốc chia đều mỗi kỳ, lãi tính trên dư nợ giảm dần;
   *                method 'annuity' → tổng trả mỗi kỳ cố định (PMT).
   * Kỳ cuối của mọi loại được ghim vào Ngày đáo hạn nếu có.
   */
  function buildSchedule(loan, opts) {
    opts = opts || {};
    var method = opts.method || 'equal';
    var t = termMonths(loan);
    var n = t.months;
    var P = loan.principal || 0;
    if (!loan.openDate || n <= 0 || P <= 0) return { rows: [], months: n, derived: t.derived, kind: loanKind(loan.termName), method: method };
    var kind = loanKind(loan.termName);
    var r = (loan.rate || 0) / 100 / 12;
    var rows = [], bal = P, k, due, interest, principal;
    var pmt = (r > 0) ? P * r / (1 - Math.pow(1 + r, -n)) : P / n;
    for (k = 1; k <= n; k++) {
      due = (k === n && loan.maturityDate) ? loan.maturityDate : addMonths(loan.openDate, k);
      interest = bal * r;
      if (kind === 'short') {
        principal = (k === n) ? bal : 0;
      } else if (method === 'annuity') {
        principal = (k === n) ? bal : Math.min(bal, pmt - interest);
      } else {
        principal = (k === n) ? bal : P / n;
      }
      rows.push({ no: k, date: due, opening: bal, principal: principal, interest: interest, total: principal + interest, closing: bal - principal });
      bal -= principal;
    }
    return { rows: rows, months: n, derived: t.derived, kind: kind, method: method };
  }

  /**
   * Tổng hợp thông tin trả nợ tại ngày báo cáo.
   * Số tiền kỳ tới được ước tính theo DƯ NỢ HIỆN TẠI (Gốc còn lại):
   *   short      → lãi = gốc còn lại × LS/12 (gốc trả cuối kỳ)
   *   amortizing → gốc = Gốc vay / số kỳ (hoặc PMT), lãi = gốc còn lại × LS/12
   */
  function paymentSummary(loan, asOf, opts) {
    opts = opts || {};
    var sch = buildSchedule(loan, opts);
    var rows = sch.rows;
    var out = { schedule: sch, closed: !(loan.balance > 0), nextRow: null, nextDate: null,
                nextPrincipal: 0, nextInterest: 0, nextTotal: 0, remainingPeriods: 0,
                finalPrincipal: 0, isFinalPeriod: false, pastMaturity: false, overdueDays: 0 };
    if (!rows.length) return out;
    var upcoming = rows.filter(function (x) { return x.date >= asOf; });
    out.remainingPeriods = upcoming.length;
    var r = (loan.rate || 0) / 100 / 12;
    var bal = loan.balance || 0;
    if (!upcoming.length) {
      out.pastMaturity = bal > 0;
      out.overdueDays = bal > 0 ? diffDays(asOf, loan.maturityDate || rows[rows.length - 1].date) : 0;
      return out;
    }
    var nx = upcoming[0];
    out.nextRow = nx; out.nextDate = nx.date;
    out.isFinalPeriod = nx.no === rows.length;
    if (bal > 0) {
      var interest = bal * r, principal = 0;
      if (sch.kind === 'short') principal = out.isFinalPeriod ? bal : 0;
      else if (out.isFinalPeriod) principal = bal;
      else if (sch.method === 'annuity') {
        var nLeft = upcoming.length;
        var p = (r > 0) ? bal * r / (1 - Math.pow(1 + r, -nLeft)) : bal / nLeft;
        principal = Math.min(bal, p - interest);
      } else principal = Math.min(bal, loan.principal / sch.months);
      out.nextInterest = interest; out.nextPrincipal = principal; out.nextTotal = interest + principal;
    }
    out.finalPrincipal = bal;
    return out;
  }

  /* ---------- Tìm kiếm ---------- */
  function normalize(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  return { addMonths: addMonths, diffDays: diffDays, excelSerialToISO: excelSerialToISO, loanKind: loanKind,
           termLabel: termLabel, termMonths: termMonths, buildSchedule: buildSchedule,
           paymentSummary: paymentSummary, normalize: normalize };
});
