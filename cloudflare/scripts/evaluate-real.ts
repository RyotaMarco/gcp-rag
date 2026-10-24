import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { argumentsFor, embedCached, loadCorpus, remote, root, sha256 } from './maintenance';
import { retrieve } from '../src/retrieval';
import { pipeline } from '../src/pipeline';
import { EMBEDDING_MODEL, GENERATION_MODEL, type Answer, type Env, type Locale } from '../src/types';

type EvaluationCase = { id: string; locale: Locale; question: string; expected_urls: string[] };
export function evaluationEnvironment(client: Awaited<ReturnType<typeof remote>>, version: string): Env {
  return {
    CORPUS_VERSION: version, MIN_DENSE_SCORE: client.minimumDenseScore,
    AI: { async run(model: string, inputs: Record<string, unknown>) {
      if (model === EMBEDDING_MODEL) return { data: await embedCached(inputs.text as string[], client.api) };
      if (model !== GENERATION_MODEL) throw new Error('Evaluation cannot select another model.');
      return client.api('/ai/run/' + model, { method: 'POST', body: JSON.stringify(inputs) });
    } },
    DB: { prepare(sql: string) { let params: unknown[] = []; return { bind(...values: unknown[]) { params = values; return this; }, async first() { return (await client.query(sql, params))[0] || null; }, async all() { return { results: await client.query(sql, params), success: true }; } }; } },
    VECTORIZE: { query(vector: number[], options: Record<string, unknown>) { return client.api(client.vectorPath + '/query', { method: 'POST', body: JSON.stringify({ vector, ...options }) }); } },
  } as unknown as Env;
}
export async function evaluateReal(args = argumentsFor()) {
  if (args.get('confirm-free') !== 'true') throw new Error('Real evaluation consumes Workers AI allowance. Confirm Workers Free with --confirm-free.');
  const target = args.get('target'); if (!target) throw new Error('Specify --target preview or production.');
  const { manifest } = await loadCorpus();
  const raw = await readFile(resolve(root, 'evaluation/real-cases.json'), 'utf8');
  const cases = JSON.parse(raw) as EvaluationCase[];
  if (cases.length < 24 || cases.some(item => !['en', 'pt'].includes(item.locale) || !item.question || !item.expected_urls.length || item.expected_urls.some(url => !manifest.sources.some(source => source.url === url)))) throw new Error('Evaluation cases must be independent questions with expected URLs present in the pinned real corpus.');
  const client = await remote(target);
  const env = evaluationEnvironment(client, manifest.version);
  const results: (EvaluationCase & { retrieved_urls: string[]; hit: boolean; reciprocal_rank: number })[] = [];
  for (const item of cases) {
    const documents = await retrieve(env, item.question, AbortSignal.timeout(60000));
    const rank = documents.findIndex(document => item.expected_urls.includes(document.url));
    results.push({ ...item, retrieved_urls: documents.map(document => document.url), hit: rank >= 0, reciprocal_rank: rank < 0 ? 0 : 1 / (rank + 1) });
    console.log(JSON.stringify({ stage: 'retrieval-evaluation', completed: results.length, total: cases.length, id: item.id, hit: rank >= 0 }));
  }
  const metrics = Object.fromEntries((['en', 'pt'] as const).map(locale => {
    const rows = results.filter(row => row.locale === locale);
    return [locale, { questions: rows.length, hits: rows.filter(row => row.hit).length, hitAt5: rows.filter(row => row.hit).length / rows.length, mrr: rows.reduce((sum, row) => sum + row.reciprocal_rank, 0) / rows.length }];
  }));
  const retrievalPassed = metrics.en.hitAt5 >= .85 && metrics.pt.hitAt5 >= .85;
  const samples: { id: string; question: string; result: Answer }[] = [];
  if (args.get('answer-samples') === 'true') {
    // One bounded sample per service, alternating locale. Editorial review is still
    // required; a valid citation does not prove every generated claim is true.
    for (const item of cases.filter((_, index) => index % 6 === (Math.floor(index / 6) % 2 ? 3 : 0))) {
      const result = await pipeline(env, { question: item.question, locale: item.locale, history: [] }, AbortSignal.timeout(60000));
      samples.push({ id: item.id, question: item.question, result });
    }
  }
  const sampleOutputPassed = args.get('answer-samples') === 'true' ? samples.length === 6 && samples.every(sample => sample.result.mode === 'rag' && sample.result.sources.length > 0) : null;
  const passed = retrievalPassed && sampleOutputPassed !== false;
  const implementationSha = sha256((await readFile(resolve(root, 'src/pipeline.ts'), 'utf8')) + '\n' + (await readFile(resolve(root, 'src/retrieval.ts'), 'utf8')));
  const report = { mode: 'real-cloudflare-retrieval', createdAt: new Date().toISOString(), target, corpusVersion: manifest.version, manifestSha: manifest.manifestSha, casesSha: sha256(raw), implementationSha, embeddingModel: EMBEDDING_MODEL, generationModel: samples.length ? GENERATION_MODEL : null, ragInferenceBudget: { embeddingCalls: 1, selectionCalls: 1, selectionMaxOutputTokens: 32, writerCalls: 1, writerMaxOutputTokens: 512, retries: 0 }, minimumDenseScore: Number(client.minimumDenseScore), retrieval: 'Vectorize cosine + D1 FTS5/BM25, RRF k=60, top5, no crossencoder', gate: { minimumHitAt5PerLocale: .85, retrievalPassed, sampleOutputPassed, passed }, metrics, results, samples, limitations: 'Small reviewed official-documentation corpus and independent curated questions. Retrieval Hit@5 does not measure generation fidelity. Existing synthetic local evaluation fixtures were not indexed or used in this report. Answer samples require independent editorial review; valid structured citations alone do not prove semantic fidelity. A RAG turn uses a bounded selection call plus a writing call on the same fixed free model; both consume the shared account allowance, with no retries.' };
  const output = resolve(root, args.get('output') || 'evaluation/real-retrieval-report.json');
  await mkdir(resolve(output, '..'), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: output, metrics, passed, answerSamples: samples.length }));
  if (!passed) throw new Error('Real retrieval or structured-answer quality gate failed. Do not enable the demo or lower the gate to make this run pass.');
}
if (import.meta.main) evaluateReal().catch(error => { console.error(error instanceof Error ? error.message : 'Evaluation failed.'); process.exitCode = 1; });
