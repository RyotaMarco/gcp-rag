function waitingLabel(seconds, locale) {
  if (seconds < 60) return locale === 'pt' ? `Aguarde ${seconds}s antes de tentar novamente.` : `Please wait ${seconds}s before trying again.`
  const unit = seconds >= 3600 ? 'hour' : 'minute'
  const amount = Math.ceil(seconds / (unit === 'hour' ? 3600 : 60))
  const relative = new Intl.RelativeTimeFormat(locale === 'pt' ? 'pt-BR' : 'en', { numeric: 'always' }).format(amount, unit)
  const date = new Intl.DateTimeFormat(locale === 'pt' ? 'pt-BR' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(Date.now() + seconds * 1000))
  return locale === 'pt' ? `Tente novamente ${relative}, por volta de ${date}.` : `Try again ${relative}, around ${date}.`
}

export const copy = {
  en: {
    title: 'GCP AI Copilot', description: 'A small window into Google Cloud. Official documentation, grounded answers, and a clearly simulated cloud project.',
    portfolio: 'Back to portfolio', language: 'Interface language', themeLight: 'Switch to light theme', themeDark: 'Switch to dark theme',
    eyebrow: 'A CLOUD WORKBENCH', headline: 'A little context.', emphasis: 'A clearer answer.',
    statusTitle: 'Demo availability', ready: 'Ready to explore', checking: 'Checking availability', notReady: 'Preparation pending', unavailable: 'Temporarily unavailable',
    refresh: 'Refresh service status', index: 'Documentation index', chunks: 'Indexed passages', provider: 'Generation service', mcp: 'Simulated tools',
    configured: 'Configured', missing: 'Not configured', available: 'Available', pending: 'Pending', healthy: 'Ready',
    coverage: 'In this edition', plannedCoverage: 'Planned coverage', localCoverageDescription: 'This installation uses its locally prepared documentation index.', coverageDescription: 'A focused set of official documentation, rather than all of Google Cloud.', collected: 'Collected', noCoverage: 'Coverage is being checked.',
    simulationNote: 'Cloud resources are fictional. This demo has no access to a real GCP account.',
    footer: 'BUILT WITH CURIOSITY', privacy: 'Conversation stays in this page. Questions are processed by Cloudflare in the public demo; do not include secrets.', localPrivacy: 'Conversation stays in this page. The local backend handles generation using your configured provider.',
    chatLabel: 'Conversation with GCP AI Copilot', toolbar: 'YOUR NEXT QUESTION', chatTitle: 'Talk to the documentation.', newChat: 'New conversation',
    messages: 'Conversation messages', welcomeLabel: 'DOCUMENTATION / EVIDENCE / ANSWERS', welcomeTitle: 'What are you figuring out?', welcomeDescription: 'Ask in English or Portuguese. Explore a concept, follow a source, or look around the simulated project.',
    examples: [
      ['DOCUMENTATION', 'How does model versioning work in Vertex AI?'],
      ['SIMULATED PROJECT', 'List the buckets in the demo project.'],
      ['DOCS + DEMO', 'Which demo VMs are running, and what does stopping a VM mean?'],
    ],
    you: 'You', assistant: 'Copilot', simulated: 'SIMULATED DATA', sources: 'Sources consulted', sourceHint: 'Answers may be partial. Check the original documentation.', excerpt: 'Supporting passage', copy: 'Copy code', copied: 'Copied',
    ask: 'Ask the copilot', placeholder: 'For example: how do Cloud Storage access permissions work?', send: 'Send', sendLabel: 'Send question', cancel: 'Cancel request',
    keyboard: 'Enter to send · Shift + Enter for a new line', waiting: seconds => waitingLabel(seconds, 'en'),
    needsVerification: 'Complete the security check to send a question.', verifying: 'Preparing the security check…', verificationMissing: 'The security check is unavailable. This demo cannot accept requests yet.',
    notReadyHint: 'Live questions become available when the demo is ready.', apiError: 'The service could not be reached. Refresh its status and try again.',
    failureTitle: 'Question not completed', retry: 'Your question is still here. You can edit it before trying again.',
    stages: { verifying: 'Checking access…', retrieving: 'Finding relevant documentation…', generating: 'Preparing an answer with sources…', tools: 'Reading the simulated project…' },
    modes: { rag: 'Documentation', mcp: 'Simulated tools', hybrid: 'Documentation + simulated tools', clarification: 'Clarification', insufficient_evidence: 'Not enough evidence' },
    errors: {
      invalid_request: 'Check your question and try again.', body_too_large: 'This question or conversation is too large. Start a new conversation.',
      origin_forbidden: 'Send questions from this demo page.', method_not_allowed: 'This request is not supported.', unsupported_media_type: 'This request format is not supported.',
      verification_required: 'Complete the security check before sending.', verification_failed: 'The security check expired or failed. Complete a new check.',
      verification_unavailable: 'The security check is unavailable. Try again later.', rate_limited: 'Too many questions in a short time. Please wait.',
      daily_limit: 'The demo has reached its daily limit. Please come back after the quota resets.', busy: 'The demo is answering other questions. Please try again shortly.',
      demo_disabled: 'Live questions are paused while the demo is prepared or reviewed.', index_unavailable: 'The documentation index is not ready. Please try again later.',
      provider_unavailable: 'The answer service is temporarily unavailable.', provider_quota: 'The AI quota has been reached. Live answers will return after the quota resets.',
      timeout: 'The request took too long. Your question has been kept for another attempt.', mcp_unavailable: 'The simulated project is temporarily unavailable.',
      cancelled: 'Request cancelled. Your question is ready to edit.', network: 'The connection was interrupted. Your question has been kept.',
      invalid_response: 'The service returned an incomplete answer. Please try again.', internal_error: 'The question could not be completed. Please try again later.',
    },
  },
  pt: {
    title: 'GCP AI Copilot', description: 'Uma pequena janela para o Google Cloud. Documentação oficial, respostas com fundamento e um projeto de nuvem claramente simulado.',
    portfolio: 'Voltar ao portfólio', language: 'Idioma da interface', themeLight: 'Usar tema claro', themeDark: 'Usar tema escuro',
    eyebrow: 'UMA BANCADA DE NUVEM', headline: 'Um pouco de contexto.', emphasis: 'Uma resposta mais clara.',
    statusTitle: 'Disponibilidade da demo', ready: 'Pronto para explorar', checking: 'Verificando disponibilidade', notReady: 'Preparação pendente', unavailable: 'Temporariamente indisponível',
    refresh: 'Atualizar estado dos serviços', index: 'Índice de documentação', chunks: 'Trechos indexados', provider: 'Serviço de geração', mcp: 'Ferramentas simuladas',
    configured: 'Configurado', missing: 'Não configurado', available: 'Disponível', pending: 'Pendente', healthy: 'Pronto',
    coverage: 'Nesta edição', plannedCoverage: 'Cobertura planejada', localCoverageDescription: 'Esta instalação usa seu próprio índice de documentação preparado localmente.', coverageDescription: 'Um recorte de documentação oficial, em vez de todo o Google Cloud.', collected: 'Coleta', noCoverage: 'Verificando a cobertura da base.',
    simulationNote: 'Os recursos de nuvem são fictícios. Esta demo não acessa uma conta GCP real.',
    footer: 'FEITO COM CURIOSIDADE', privacy: 'A conversa fica nesta página. As perguntas são processadas pela Cloudflare na demo pública; não inclua segredos.', localPrivacy: 'A conversa fica nesta página. O backend local gera respostas usando o provedor configurado por você.',
    chatLabel: 'Conversa com o GCP AI Copilot', toolbar: 'SUA PRÓXIMA PERGUNTA', chatTitle: 'Converse com a documentação.', newChat: 'Nova conversa',
    messages: 'Mensagens da conversa', welcomeLabel: 'DOCUMENTAÇÃO / EVIDÊNCIA / RESPOSTAS', welcomeTitle: 'O que você está descobrindo?', welcomeDescription: 'Pergunte em português ou inglês. Explore um conceito, consulte uma fonte ou conheça o projeto simulado.',
    examples: [
      ['DOCUMENTAÇÃO', 'Como funciona o versionamento de modelos no Vertex AI?'],
      ['PROJETO SIMULADO', 'Liste os buckets do projeto de demonstração.'],
      ['DOCS + DEMO', 'Quais VMs da demo estão ativas e o que significa parar uma VM?'],
    ],
    you: 'Você', assistant: 'Copilot', simulated: 'DADOS SIMULADOS', sources: 'Fontes consultadas', sourceHint: 'As respostas podem ser parciais. Confira a documentação original.', excerpt: 'Trecho de apoio', copy: 'Copiar código', copied: 'Copiado',
    ask: 'Pergunte ao copilot', placeholder: 'Por exemplo: como funcionam as permissões de acesso no Cloud Storage?', send: 'Enviar', sendLabel: 'Enviar pergunta', cancel: 'Cancelar consulta',
    keyboard: 'Enter para enviar · Shift + Enter para nova linha', waiting: seconds => waitingLabel(seconds, 'pt'),
    needsVerification: 'Conclua a verificação de segurança para enviar uma pergunta.', verifying: 'Preparando a verificação de segurança…', verificationMissing: 'A verificação de segurança está indisponível. A demo ainda não pode receber consultas.',
    notReadyHint: 'As consultas ficam disponíveis quando a demo estiver pronta.', apiError: 'Não foi possível acessar o serviço. Atualize o estado e tente novamente.',
    failureTitle: 'Consulta não concluída', retry: 'Sua pergunta continua aqui. Você pode editá-la antes de tentar novamente.',
    stages: { verifying: 'Verificando acesso…', retrieving: 'Buscando documentação relevante…', generating: 'Preparando uma resposta com fontes…', tools: 'Consultando o projeto simulado…' },
    modes: { rag: 'Documentação', mcp: 'Ferramentas simuladas', hybrid: 'Documentação + ferramentas simuladas', clarification: 'Esclarecimento', insufficient_evidence: 'Evidência insuficiente' },
    errors: {
      invalid_request: 'Confira a pergunta e tente novamente.', body_too_large: 'A pergunta ou a conversa está muito grande. Inicie uma nova conversa.',
      origin_forbidden: 'Envie a pergunta pela página da demo.', method_not_allowed: 'Esta solicitação não é permitida.', unsupported_media_type: 'O formato da solicitação não é permitido.',
      verification_required: 'Conclua a verificação de segurança antes de enviar.', verification_failed: 'A verificação de segurança expirou ou falhou. Faça uma nova verificação.',
      verification_unavailable: 'A verificação de segurança está indisponível. Tente mais tarde.', rate_limited: 'Muitas perguntas em pouco tempo. Aguarde um instante.',
      daily_limit: 'A demo atingiu o limite diário. Volte depois que a cota for renovada.', busy: 'A demo está respondendo a outras perguntas. Tente novamente em instantes.',
      demo_disabled: 'As consultas estão pausadas enquanto a demo é preparada ou revisada.', index_unavailable: 'O índice de documentação ainda não está pronto. Tente mais tarde.',
      provider_unavailable: 'O serviço de respostas está temporariamente indisponível.', provider_quota: 'A cota de IA foi atingida. As respostas voltam após a renovação da cota.',
      timeout: 'A consulta demorou além do limite. Sua pergunta foi preservada para uma nova tentativa.', mcp_unavailable: 'O projeto simulado está temporariamente indisponível.',
      cancelled: 'Consulta cancelada. Sua pergunta está pronta para editar.', network: 'A conexão foi interrompida. Sua pergunta foi preservada.',
      invalid_response: 'O serviço retornou uma resposta incompleta. Tente novamente.', internal_error: 'Não foi possível concluir a consulta. Tente novamente mais tarde.',
    },
  },
}

export function pathLocale(path = window.location.pathname) { return /^\/pt(?:\/|$)/.test(path) ? 'pt' : 'en' }
export function initialTheme() {
  const explicit = new URLSearchParams(window.location.search).get('theme')
  if (explicit === 'light' || explicit === 'dark') return explicit
  try { return localStorage.getItem('gcp-theme') === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}
