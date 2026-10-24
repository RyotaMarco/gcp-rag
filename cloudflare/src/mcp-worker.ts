import { WorkerEntrypoint } from 'cloudflare:workers';
import { mcpResponse } from './mcp';

// Named entrypoint is bound by the public Worker. The default network handler
// intentionally remains a 404 even if a route were accidentally configured.
export class McpPrivate extends WorkerEntrypoint {
  async fetch(request: Request) { return mcpResponse(request); }
}
export default { async fetch() { return new Response(null, { status: 404 }); } };
