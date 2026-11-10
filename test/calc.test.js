const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/calc.js');

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('addMonths giữ cuối tháng', () => {
  assert.equal(C.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(C.addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(C.addMonths('2025-10-27', 12), '2026-10-27');
  assert.equal(C.addMonths('2025-11-15', 3), '2026-02-15');
});

test('excelSerialToISO', () => {
  assert.equal(C.excelSerialToISO(45957), '2025-10-27');
});

test('ngắn hạn: chỉ trả lãi hàng tháng, gốc cuối kỳ', () => {
  const loan = { principal: 120e6, balance: 120e6, rate: 12, term: '12', termName: 'NGANHAN', openDate: '2026-01-10', maturityDate: '2027-01-10' };
  const s = C.buildSchedule(loan);
  assert.equal(s.rows.length, 12);
  near(s.rows[0].interest, 1.2e6);
  assert.equal(s.rows[0].principal, 0);
  near(s.rows[11].principal, 120e6);
  near(s.rows[11].total, 121.2e6);
  assert.equal(s.rows[11].date, '2027-01-10');
  const p = C.paymentSummary(loan, '2026-11-09');
  assert.equal(p.nextDate, '2026-11-10');
  near(p.nextTotal, 1.2e6);
  assert.equal(p.remainingPeriods, 3);
});

test('trung/dài hạn: gốc đều, lãi theo dư nợ giảm dần', () => {
  const loan = { principal: 120e6, balance: 120e6, rate: 12, term: '12', termName: 'TRUNGHAN', openDate: '2026-01-10', maturityDate: '2027-01-10' };
  const s = C.buildSchedule(loan);
  near(s.rows[0].principal, 10e6); near(s.rows[0].interest, 1.2e6); near(s.rows[0].total, 11.2e6);
  near(s.rows[1].interest, 1.1e6); near(s.rows[1].total, 11.1e6);
  near(s.rows[11].closing, 0);
  const sumP = s.rows.reduce((a, r) => a + r.principal, 0);
  near(sumP, 120e6);
});

test('niên kim: tổng trả mỗi kỳ cố định, hết gốc ở kỳ cuối', () => {
  const loan = { principal: 100e6, balance: 100e6, rate: 12, term: '12', termName: 'TRUNGHAN', openDate: '2026-01-10', maturityDate: '2027-01-10' };
  const s = C.buildSchedule(loan, { method: 'annuity' });
  near(s.rows[0].total, 8884878.867, 1);
  near(s.rows[5].total, 8884878.867, 1);
  near(s.rows[11].closing, 0, 1);
});

test('dư nợ hiện tại giảm → lãi kỳ tới tính trên gốc còn lại', () => {
  const loan = { principal: 120e6, balance: 60e6, rate: 12, term: '12', termName: 'TRUNGHAN', openDate: '2026-01-10', maturityDate: '2027-01-10' };
  const p = C.paymentSummary(loan, '2026-07-15');
  assert.equal(p.nextDate, '2026-08-10');
  near(p.nextInterest, 0.6e6); near(p.nextPrincipal, 10e6); near(p.nextTotal, 10.6e6);
  assert.equal(p.remainingPeriods, 6);
});

test('kỳ hạn trống → suy ra từ ngày; tất toán → 0', () => {
  const l = { principal: 5e6, balance: 5e6, rate: 10, term: '', termName: 'NGANHAN', openDate: '2026-01-01', maturityDate: '2026-07-01' };
  assert.deepEqual(C.termMonths(l), { months: 6, derived: true });
  const closed = { principal: 5e6, balance: 0, rate: 10, term: '6', termName: 'NGANHAN', openDate: '2026-01-01', maturityDate: '2026-07-01' };
  const p = C.paymentSummary(closed, '2026-03-01');
  assert.equal(p.closed, true); assert.equal(p.nextTotal, 0);
});

test('quá ngày đáo hạn còn dư nợ', () => {
  const l = { principal: 10e6, balance: 10e6, rate: 12, term: '6', termName: 'NGANHAN', openDate: '2026-01-01', maturityDate: '2026-07-01' };
  const p = C.paymentSummary(l, '2026-07-11');
  assert.equal(p.pastMaturity, true); assert.equal(p.overdueDays, 10);
});

test('normalize tiếng Việt', () => {
  assert.equal(C.normalize('  Nguyễn  Thị Hồng Đào '), 'nguyen thi hong dao');
});
