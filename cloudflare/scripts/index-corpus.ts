import { argumentsFor, embedCached, loadCorpus, remote, VECTORIZE_READ_BATCH, vectorsByIds } from './maintenance';

export async function indexCorpus(args = argumentsFor()) {
  const { manifest, chunks } = await loadCorpus();
  const target = args.get('target');
  if (!target) throw new Error('Specify --target preview or --target production.');
  if (args.get('apply') !== 'true') { console.log(JSON.stringify({ dryRun: true, target, version: manifest.version, pages: manifest.pages, chunks: manifest.chunks, requires: '--apply --confirm-free' })); return; }
  if (args.get('confirm-free') !== 'true') throw new Error('Confirm the account uses Workers Free before running this AI-consuming maintenance command: --confirm-free.');
  const client = await remote(target);
  const existing = await client.query<{ ready: number; manifest_sha: string }>('SELECT ready,manifest_sha FROM corpus_versions WHERE version=?', [manifest.version]);
  if (existing.length && existing[0].manifest_sha !== manifest.manifestSha) throw new Error('A corpus version cannot be overwritten with different source data.');
  const vectors = await embedCached(chunks.map(chunk => chunk.text), client.api);
  await client.query('INSERT INTO corpus_versions(version,embedding_model,dimensions,chunk_count,page_count,created_at,manifest_sha,ready) VALUES(?,?,?,?,?,?,?,0) ON CONFLICT(version) DO NOTHING', [manifest.version, manifest.embeddingModel, manifest.dimensions, manifest.chunks, manifest.pages, manifest.collectedAt, manifest.manifestSha]);
  if (!existing[0]?.ready) {
    for (let offset = 0; offset < chunks.length; offset += 10) {
      const batch = chunks.slice(offset, offset + 10);
      await client.query('INSERT INTO chunks(id,version,url,title,product,section,crawled_at,text) VALUES ' + batch.map(() => '(?,?,?,?,?,?,?,?)').join(',') + ' ON CONFLICT(id) DO UPDATE SET version=excluded.version,url=excluded.url,title=excluded.title,product=excluded.product,section=excluded.section,crawled_at=excluded.crawled_at,text=excluded.text', batch.flatMap(chunk => [chunk.id, chunk.version, chunk.url, chunk.title, chunk.product, chunk.section, chunk.crawled_at, chunk.text]));
    }
    await client.query('DELETE FROM chunks_fts WHERE version=?', [manifest.version]);
    await client.query('INSERT INTO chunks_fts(id,version,text,title,product) SELECT id,version,text,title,product FROM chunks WHERE version=?', [manifest.version]);
  }
  let lastMutation = '';
  for (let offset = 0; offset < chunks.length; offset += 100) {
    const batch = chunks.slice(offset, offset + 100).map((chunk, local) => ({ id: chunk.id, values: vectors[offset + local], metadata: { version: chunk.version, product: chunk.product, url: chunk.url } }));
    const form = new FormData(); form.append('vectors', new File([batch.map(value => JSON.stringify(value)).join('\n') + '\n'], 'vectors.ndjson', { type: 'application/x-ndjson' }));
    lastMutation = (await client.api<{ mutationId: string }>(client.vectorPath + '/upsert', { method: 'POST', body: form })).mutationId;
    console.log(JSON.stringify({ stage: 'vector-upsert', completed: Math.min(offset + batch.length, chunks.length), total: chunks.length, mutationId: lastMutation }));
  }
  let ready = false;
  for (let attempt = 0; attempt < 24; attempt++) {
    let present = 0;
    for (let offset = 0; offset < chunks.length; offset += VECTORIZE_READ_BATCH) {
      const batch = chunks.slice(offset, offset + VECTORIZE_READ_BATCH);
      const result = await vectorsByIds(client, batch.map(chunk => chunk.id));
      if (!Array.isArray(result)) throw new Error('Vectorize returned an unexpected verification response.');
      present += result.filter(vector => vector.metadata?.version === manifest.version && batch.some(chunk => chunk.id === vector.id)).length;
    }
    const count = (await client.query<{ total: number }>('SELECT COUNT(*) AS total FROM chunks WHERE version=?', [manifest.version]))[0]?.total;
    const fts = (await client.query<{ total: number }>('SELECT COUNT(*) AS total FROM chunks_fts WHERE version=?', [manifest.version]))[0]?.total;
    const matches = await client.api<{ matches: { id: string }[] }>(client.vectorPath + '/query', { method: 'POST', body: JSON.stringify({ vector: vectors[0], topK: 1, filter: { version: manifest.version }, returnMetadata: 'none' }) });
    console.log(JSON.stringify({ stage: 'verify-index', attempt: attempt + 1, vectors: present, expected: chunks.length }));
    if (present === chunks.length && count === chunks.length && fts === chunks.length && matches.matches.some(match => chunks.some(chunk => chunk.id === match.id))) { ready = true; break; }
    await Bun.sleep(5000);
  }
  if (!ready) throw new Error('Index propagation verification did not complete. The new version remains inactive; rerun this idempotent command later.');
  await client.query('UPDATE corpus_versions SET ready=1 WHERE version=? AND manifest_sha=?', [manifest.version, manifest.manifestSha]);
  console.log(JSON.stringify({ ready: true, target, database: client.database, index: client.index, version: manifest.version, chunks: chunks.length, lastMutation, note: 'Activation still requires pinning CORPUS_VERSION in the deployment; no Worker or quota setting was changed.' }));
}
if (import.meta.main) indexCorpus().catch(error => { console.error(error instanceof Error ? error.message : 'Maintenance failed.'); process.exitCode = 1; });
