# Avaliação reproduzível

Esta suíte contém **42 casos**, incluindo **30 perguntas de recuperação** em
português e inglês, duas perguntas de continuidade e dez casos de comportamento
(ambiguidade, falta de evidência, MCP e combinação de ferramentas/documentação).

Os 15 documentos de `corpus/` são **paráfrases escritas para teste**, com URLs de
referência oficiais. Não são uma coleta recente nem uma cópia completa da
documentação. `crawled_at: null` e `fixture: true` identificam essa limitação.
Preços, disponibilidade e limites atuais não são representados pelas fixtures.

## Smoke determinístico, sem download de modelos ou chamada de LLM

```bash
python -m evaluation.run --mode fixture --output evaluation-report.json
```

O comando indexa as fixtures em Qdrant em memória e executa o Retriever real,
substituindo somente embedding e reranker por modelos de teste determinísticos.
Estes usam palavras e um pequeno vocabulário bilíngue, sem consultar os rótulos
esperados. Esse modo verifica a integração e a métrica. **Seu resultado não
mede a qualidade dos modelos neurais nem das respostas geradas.**

## Modelos locais reais

```bash
python -m evaluation.run --mode real --output evaluation-real-report.json
# Comparar também com o embedding inglês da implementação inicial:
python -m evaluation.run --mode real --compare-original --output evaluation-before-after.json
```

Exige dependências de execução, memória e acesso inicial ao Hugging Face para
baixar os modelos configurados. Também pode ser executado na imagem da stack:

```bash
docker compose --profile tools run --rm --entrypoint python ingest -m evaluation.run --mode real --output /data/evaluation-real-report.json
```

A medição continua limitada ao corpus pequeno e curado. Para avaliar a coleta
real, forneça `--corpus` com documentos no mesmo formato e `--cases` com perguntas
revisadas independentemente e URLs esperadas presentes nessa coleta. Mantenha um
conjunto separado dos exemplos usados para ajustar pesos e limiares.

## Métrica e comparação

- **Hit@5**: fração das perguntas respondíveis que têm pelo menos uma URL
  relevante entre os cinco primeiros resultados. Não é Precision@5.
- **MRR**: média do inverso da posição da primeira fonte relevante.
- **Baseline**: busca apenas semântica usando o mesmo embedding da execução.
  Essa comparação isola busca híbrida/reordenação; não reproduz o antigo modelo
  inglês `all-MiniLM-L6-v2` do repositório.
- **Comparação original opcional**: `--compare-original`, somente em modo real,
  indexa o mesmo corpus em um segundo Qdrant temporário com
  `sentence-transformers/all-MiniLM-L6-v2`, texto sem prefixos e busca por cosseno.
  Reproduz o modelo e a estratégia de busca antigos, não a antiga coleta inteira.
  O resultado fica em `original_baseline`; o gate continua aplicado só à híbrida.
- **Gate**: o processo termina com código 1 quando Hit@5 híbrido fica abaixo de
  85%. O relatório JSON registra modo, modelos, corpus, resultados e limitação.
- Casos de continuidade concatenam apenas o contexto anterior do usuário; o
  benchmark de recuperação não presume uma reescrita por LLM.
- Os dez casos de comportamento ficam listados explicitamente como não
  executados pelo benchmark de recuperação. São critérios para testes de
  API/roteamento e não entram no denominador de Hit@5.

## Atualizar a suíte

Cada documento JSON tem `content` e `metadata` com `source_url`, `title`,
`product`, `section`, `crawled_at`. Cada pergunta respondível de `cases.json`
declara `expected_urls`; os modelos nunca recebem esses rótulos. Não altere
perguntas ou fontes esperadas apenas para fazer um resultado insuficiente passar.
