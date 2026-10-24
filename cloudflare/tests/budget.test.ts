import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { BudgetLedger, nextCleanupAlarm } from '../src/budget-ledger';
import { sqlAdapter } from './helpers';

const identity = (number: number) => number.toString(16).padStart(64, '0');
test('cleanup is scheduled at UTC midnight instead of allowing an extra hourly retention window', () => {
  expect(nextCleanupAlarm(Date.parse('2026-10-24T23:45:00Z'))).toBe(Date.parse('2026-10-25T00:00:00Z'));
  expect(nextCleanupAlarm(Date.parse('2026-10-24T12:00:00Z'))).toBe(Date.parse('2026-10-24T13:00:00Z'));
  expect(nextCleanupAlarm(Date.parse('2026-10-24T23:59:59.999Z'))).toBe(Date.parse('2026-10-25T00:00:00Z'));
});
test('ledger enforces concurrency and expiration without refunding daily attempts', () => {
  const db = new Database(':memory:'); const ledger = new BudgetLedger(sqlAdapter(db)); const now = Date.parse('2026-10-24T12:00:00Z');
  const first = db.transaction(() => ledger.reserve(identity(1), 'production', now))();
  const second = ledger.reserve(identity(2), 'production', now);
  expect(first.allowed).toBe(true); expect(second.allowed).toBe(true);
  expect(ledger.reserve(identity(3), 'production', now)).toMatchObject({ allowed: false, code: 'busy' });
  if (first.allowed) ledger.release(first.lease);
  expect(ledger.reserve(identity(3), 'production', now).allowed).toBe(true);
  expect(ledger.reserve(identity(4), 'production', now + 30001).allowed).toBe(true);
  expect((db.query('SELECT total FROM counts WHERE kind="global"').get() as { total: number }).total).toBe(4);
  db.close();
});
test('per-network minute/day and shared preview limits are independent of worker location', () => {
  const db = new Database(':memory:'); const ledger = new BudgetLedger(sqlAdapter(db)); const now = Date.parse('2026-10-24T12:00:00Z');
  for (let n = 0; n < 10; n++) {
    const result = ledger.reserve(identity(1), 'production', now + Math.floor(n / 3) * 60000);
    expect(result.allowed).toBe(true); if (result.allowed) ledger.release(result.lease);
    if (n === 2) expect(ledger.reserve(identity(1), 'production', now)).toMatchObject({ allowed: false, code: 'rate_limited' });
  }
  expect(ledger.reserve(identity(1), 'production', now + 10 * 60000)).toMatchObject({ allowed: false, code: 'daily_limit' });
  for (let n = 2; n < 12; n++) { const result = ledger.reserve(identity(n), 'preview', now); expect(result.allowed).toBe(true); if (result.allowed) ledger.release(result.lease); }
  expect(ledger.reserve(identity(12), 'preview', now)).toMatchObject({ allowed: false, code: 'daily_limit' });
  // Preview contributes to, rather than resets, the production/global counter.
  expect((db.query('SELECT total FROM counts WHERE kind="global"').get() as { total: number }).total).toBe(20);
  db.close();
});
test('one hundred admitted requests exhaust the global day and UTC reset/cleanup are deterministic', () => {
  const db = new Database(':memory:'); const ledger = new BudgetLedger(sqlAdapter(db)); const now = Date.parse('2026-10-24T12:00:00Z');
  for (let n = 1; n <= 100; n++) { const result = ledger.reserve(identity(n), 'production', now); expect(result.allowed).toBe(true); if (result.allowed) ledger.release(result.lease); }
  expect(ledger.reserve(identity(101), 'production', now)).toMatchObject({ allowed: false, code: 'daily_limit', retryAfter: 43200 });
  expect(ledger.reserve(identity(101), 'production', now + 86400000).allowed).toBe(true);
  ledger.cleanup(now + 4 * 86400000);
  expect((db.query('SELECT COUNT(*) AS total FROM counts').get() as { total: number }).total).toBe(0);
  db.close();
});


test('cleanup retains no third UTC bucket of daily IP pseudonyms', () => {
  const db = new Database(':memory:'); const ledger = new BudgetLedger(sqlAdapter(db));
  for (const date of ['2026-10-22T23:59:00Z', '2026-10-23T23:59:00Z', '2026-10-24T00:00:00Z']) {
    const result = ledger.reserve(identity(1), 'production', Date.parse(date));
    if (result.allowed) ledger.release(result.lease);
  }
  ledger.cleanup(Date.parse('2026-10-24T01:00:00Z'));
  const days = db.query('SELECT DISTINCT day FROM counts ORDER BY day').all() as { day: string }[];
  expect(days.map(row => row.day)).toEqual(['2026-10-23', '2026-10-24']);
  db.close();
});
