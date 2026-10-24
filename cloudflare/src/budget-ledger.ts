import type { BudgetResult } from './types';

export function nextCleanupAlarm(now: number): number {
  const midnight = Date.parse(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z') + 86400000;
  return Math.min(now + 3600000, midnight);
}

// This synchronous ledger is run only inside one SQLite Durable Object. Keeping
// admission and all counter writes in one storage transaction prevents races.
export interface LedgerSql {
  exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(query: string, ...bindings: SqlStorageValue[]): { toArray(): T[] };
}
export class BudgetLedger {
  constructor(private sql: LedgerSql) {
    sql.exec('CREATE TABLE IF NOT EXISTS counts (day TEXT NOT NULL, kind TEXT NOT NULL, identity TEXT NOT NULL, total INTEGER NOT NULL, PRIMARY KEY(day,kind,identity))');
    sql.exec('CREATE TABLE IF NOT EXISTS minutes (minute INTEGER NOT NULL, identity TEXT NOT NULL, total INTEGER NOT NULL, PRIMARY KEY(minute,identity))');
    sql.exec('CREATE TABLE IF NOT EXISTS leases (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)');
  }
  private total(day: string, kind: string, identity: string): number {
    return this.sql.exec<{ total: number }>('SELECT total FROM counts WHERE day=? AND kind=? AND identity=?', day, kind, identity).toArray()[0]?.total || 0;
  }
  private increment(day: string, kind: string, identity: string) {
    this.sql.exec('INSERT INTO counts(day,kind,identity,total) VALUES(?,?,?,1) ON CONFLICT(day,kind,identity) DO UPDATE SET total=total+1', day, kind, identity);
  }
  cleanup(now: number) {
    this.sql.exec('DELETE FROM leases WHERE expires<=?', now);
    this.sql.exec('DELETE FROM minutes WHERE minute<?', Math.floor(now / 60000) - 2);
    // A daily identity is only needed for the current and previous UTC day.
    // Keeping a third UTC bucket could retain pseudonyms for almost 72 hours.
    this.sql.exec('DELETE FROM counts WHERE day<?', new Date(now - 24 * 3600000).toISOString().slice(0, 10));
  }
  reserve(identity: string, environment: string, now: number): BudgetResult {
    if (!/^[a-f0-9]{64}$/.test(identity) || !['production', 'preview'].includes(environment)) throw new Error('invalid_admission');
    this.cleanup(now);
    const day = new Date(now).toISOString().slice(0, 10);
    const nextDay = Date.parse(day + 'T00:00:00Z') + 86400000;
    const retryDay = Math.max(1, Math.ceil((nextDay - now) / 1000));
    const minute = Math.floor(now / 60000);
    const recent = this.sql.exec<{ total: number }>('SELECT total FROM minutes WHERE minute=? AND identity=?', minute, identity).toArray()[0]?.total || 0;
    if (recent >= 3) return { allowed: false, code: 'rate_limited', retryAfter: Math.max(1, Math.ceil(((minute + 1) * 60000 - now) / 1000)) };
    if (this.total(day, 'visitor', identity) >= 10 || this.total(day, 'global', '*') >= 100 || (environment === 'preview' && this.total(day, 'preview', '*') >= 10)) return { allowed: false, code: 'daily_limit', retryAfter: retryDay };
    const leases = this.sql.exec<{ expires: number }>('SELECT expires FROM leases ORDER BY expires').toArray();
    if (leases.length >= 2) return { allowed: false, code: 'busy', retryAfter: Math.max(1, Math.ceil((leases[0].expires - now) / 1000)) };
    this.increment(day, 'visitor', identity);
    this.increment(day, 'global', '*');
    if (environment === 'preview') this.increment(day, 'preview', '*');
    this.sql.exec('INSERT INTO minutes(minute,identity,total) VALUES(?,?,1) ON CONFLICT(minute,identity) DO UPDATE SET total=total+1', minute, identity);
    const lease = crypto.randomUUID();
    this.sql.exec('INSERT INTO leases(id,expires) VALUES(?,?)', lease, now + 30000);
    return { allowed: true, lease };
  }
  release(lease: string) {
    if (!/^[0-9a-f-]{36}$/.test(lease)) return;
    this.sql.exec('DELETE FROM leases WHERE id=?', lease);
  }
}
