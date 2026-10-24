import { expect, test } from 'bun:test';
import { loadCorpus, vectorsByIds, VECTORIZE_READ_BATCH } from '../scripts/maintenance';

test('the deployable corpus is real, hash-verified, bounded and distinct from synthetic evaluation fixtures', async () => {
  const { manifest, chunks } = await loadCorpus();
  expect(manifest.fixture).toBe(false); expect(manifest.pages).toBeLessThanOrEqual(30); expect(chunks.length).toBeLessThanOrEqual(750);
  expect(manifest.services).toHaveLength(6); expect(chunks.every(chunk => chunk.crawled_at && chunk.id.startsWith(manifest.version + ':'))).toBe(true);
});
test('maintenance Vectorize reads obey the actual REST wrapper and twenty-ID limit', async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const client = { vectorPath: '/vectorize/v2/indexes/test', async api<T>(path: string, init?: RequestInit): Promise<T> { calls.push({ path, init }); return [] as T; } };
  await vectorsByIds(client, ['test:1']);
  expect(calls[0].path).toEndWith('/get_by_ids');
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({ ids: ['test:1'] });
  expect(VECTORIZE_READ_BATCH).toBe(20);
  await expect(vectorsByIds(client, Array.from({ length: 21 }, (_, index) => String(index)))).rejects.toThrow('between 1 and 20');
  expect(calls).toHaveLength(1);
});
