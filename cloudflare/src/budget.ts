import { DurableObject } from 'cloudflare:workers';
import { BudgetLedger, nextCleanupAlarm } from './budget-ledger';
import type { BudgetResult, Env } from './types';

export class BudgetGuard extends DurableObject<Env> {
  private ledger: BudgetLedger;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ledger = new BudgetLedger(ctx.storage.sql);
  }
  async reserve(identity: string, environment: string): Promise<BudgetResult> {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => this.ledger.reserve(identity, environment, now));
    const scheduled = await this.ctx.storage.getAlarm();
    const next = nextCleanupAlarm(now);
    if (scheduled === null || scheduled > next) await this.ctx.storage.setAlarm(next);
    return result;
  }
  async release(lease: string) { this.ctx.storage.transactionSync(() => this.ledger.release(lease)); }
  async healthy() { this.ctx.storage.sql.exec('SELECT 1').toArray(); return true; }
  async alarm() {
    const now = Date.now();
    this.ctx.storage.transactionSync(() => this.ledger.cleanup(now));
    await this.ctx.storage.setAlarm(nextCleanupAlarm(now));
  }
  async fetch() { return new Response(null, { status: 404 }); }
}
