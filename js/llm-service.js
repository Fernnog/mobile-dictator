/**
 * LlamaTextService - Arquiteto de Produto Front-end
 * Versão: 1.2.0 (Refatoração de Prompt Delegador)
 * Finalidade: Processamento de texto via LLM com saída estrita.
 */

import { CONFIG } from './config.js';

// 1. PROMPT EXTERNO (Vai para a Área de Transferência para o ChatGPT/Claude)
export const EXTERNAL_LEGAL_PROMPT = `# PERSONA
Assuma a persona de um Assessor Jurídico Trabalhista Sênior e Revisor de Peças.
Sua missão é atuar sob a minha coordenação, redigindo, revisando ou fundamentando peças, votos, acórdãos ou sentenças da Justiça do Trabalho, com base exclusivamente nas diretrizes e notas que fornecerei abaixo.

# DIRETRIZES DE ATUAÇÃO
- Utilize linguagem técnica, porém clara e objetiva (Linguagem Simples).
- Evite latinismos herméticos e frases excessivamente longas.
- Mantenha estritamente a verdade dos fatos apontados nas minhas diretrizes.
- Não presuma, acrescente ou invente dados processuais.

Abaixo estão as minhas diretrizes e o contexto da peça. Execute o raciocínio jurídico e entregue o resultado conforme solicitado:`;

// [BACKUP DE SEGURANÇA] Mantido para rollback rápido via GitHub
const LEGACY_INTERNAL_CLEANUP_PROMPT = `Atue como um Engenheiro de Prompt Especialista no fluxo jurídico.
O usuário ditou oralmente suas análises de um processo trabalhista (fatos e tópicos recursais).
MISSÃO: Transformar essa transcrição bruta em um conjunto de diretrizes estruturadas e imperativas. Este texto servirá como comando/roteiro para que OUTRO modelo de linguagem redija a peça jurídica.

REGRAS OBRIGATÓRIAS:
1. Utilize verbos no imperativo para iniciar os comandos (ex: "Avalie a distribuição do ônus...", "Verifique a ausência...", "Acolha a preliminar...").
2. É ESTRITAMENTE PROIBIDO redigir a peça jurídica, o voto ou a decisão. Sua saída deve conter apenas o roteiro de comandos.
3. Organize as instruções em tópicos (bullet points) para facilitar o processamento do modelo de terceiros.
4. Elimine gagueiras ou repetições da fala e corrija a gramática, mas PRESERVE intactos os jargões, o mérito da decisão e as provas citadas.
5. Responda EXCLUSIVAMENTE com as diretrizes organizadas, sem aspas, introduções, saudações ou blocos de código (\`\`\`).`;

// 2. NOVO PROMPT INTERNO (Groq/Llama) - Foco em Dual-Comportamento
const INTERNAL_CLEANUP_PROMPT = `Atue como um Assistente de Revisão Jurídica Inteligente.
O usuário ditou anotações sobre um processo judicial. Estas anotações assumirão um de dois cenários:
CENÁRIO A (Diretrizes): Instruções de como outra IA deve redigir a peça (ex: "durante a fundamentação da minuta, destaque que...").
CENÁRIO B (Texto Exato): O raciocínio direto ou trecho que já deve compor a peça.

SUA MISSÃO: Processar a transcrição corrigindo erros de captação de voz, gagueiras e falhas de concordância, preservando ao máximo as palavras originais e o fluxo do pensamento.

REGRAS OBRIGATÓRIAS:
1. ABORDAGEM SUAVE: O estilo, o tom e as palavras do autor devem ser rigorosamente mantidos.
2. ESTRUTURA ORIGINAL: É ESTRITAMENTE PROIBIDO transformar o texto em listas (bullet points) ou forçar verbos no imperativo (ex: "Avalie", "Faça"), a menos que o usuário tenha falado exatamente dessa forma.
3. ADAPTAÇÃO AO CENÁRIO:
   - Se identificar o CENÁRIO A (ou se o usuário usar a flag [MODO_DIRETRIZ]), apenas limpe o texto para que a instrução fique cristalina para a próxima IA.
   - Se identificar o CENÁRIO B, apenas conecte as frases e corrija a gramática levemente.
4. INTEGRIDADE DOS DADOS: Preserve intactos todos os jargões jurídicos, citações, valores, nomes e referências processuais.
5. SAÍDA RESTRITA: Responda EXCLUSIVAMENTE com o texto revisado, sem adicionar introduções, aspas ou blocos de código (\`\`\`).`;

// 3. PROMPT DE REVISÃO GRAMATICAL
const GRAMMAR_FIX_PROMPT = `Atue como um Revisor Técnico de Língua Portuguesa.

Sua única tarefa é corrigir erros de gramática, ortografia, pontuação, regência e concordância no texto fornecido.

REGRAS OBRIGATÓRIAS:
1. Preserve o estilo, voz e escolha de palavras originais.
2. Altere apenas o que violar a norma-padrão. Não faça embelezamentos ou melhorias estilísticas.
3. Responda EXCLUSIVAMENTE com o texto final corrigido em formato de texto puro.
4. É estritamente proibido incluir saudações, explicações, blocos de código (\`\`\`) ou qualquer palavra fora do texto revisado.`;

class GroqLlmService {
    constructor() {
        this.apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
        this.storageKey = 'dd_groq_token'; 
    }

    getToken() {
        let token = localStorage.getItem(this.storageKey);
        if (!token) {
            token = prompt("🔑 Chave da Groq necessária:\n\nInsira sua API Key da Groq (Inicia com 'gsk_'):");
            if (token && token.startsWith('gsk_')) {
                localStorage.setItem(this.storageKey, token);
            } else {
                throw new Error("Token inválido ou não fornecido. Ação cancelada.");
            }
        }
        return token;
    }

    async generate(systemPrompt, userText) {
        const token = this.getToken();
        
        // Contrato de Dados estruturado para Modelos de Raciocínio (Reasoning)
        const payload = {
            model: CONFIG.LLM.MODEL_ID,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userText }
            ],
            temperature: CONFIG.LLM.TEMPERATURE,
            max_completion_tokens: CONFIG.LLM.MAX_COMPLETION_TOKENS,
            top_p: CONFIG.LLM.TOP_P,
            reasoning_effort: CONFIG.LLM.REASONING_EFFORT,
            stream: false
        };

        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                let errorDetail = `Erro HTTP ${response.status}`;
                try {
                    const errData = await response.json();
                    errorDetail = errData.error?.message || errorDetail;
                } catch (e) { }
                
                if (response.status === 401) localStorage.removeItem(this.storageKey);
                throw new Error(errorDetail);
            }

            const data = await response.json();
            let content = data.choices[0].message.content.trim();

            // [NOVO] PIPELINE DE SANITIZAÇÃO ESTRUTURAL
            // 1. Remove cadeia de pensamentos (Chain of Thought) de modelos reasoning (ex: Qwen)
            content = content.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();

            // 2. Limpa aspas indesejadas (legado mantido)
            content = content.replace(/^"|"$/g, '').trim();
            
            // 3. Extrai texto de dentro de blocos Markdown (```), descartando o lixo ao redor
            content = content.replace(/^```[\w]*\r?\n?([\s\S]*?)\r?\n?```[\s\S]*$/i, '$1').trim();

            return content;

        } catch (error) {
            console.error("Llama Service Error:", error);
            throw error;
        }
    }

    async fixGrammar(text) {
        const userPrompt = `TEXTO PARA REVISÃO:\n\n${text}`;

        return await this.generate(GRAMMAR_FIX_PROMPT, userPrompt);
    }

    async convertToLegal(text) {
        // 1. Rede de Segurança Determinística: Analisa o texto em busca de âncoras vocais do usuário
        const lowerText = text.toLowerCase();
        const isExplicitGuideline = /durante a fundamenta|na minuta|diretriz|ordem para/i.test(lowerText);
        
        // Injeção de flag de contexto baseada na intenção detectada
        const contextFlag = isExplicitGuideline ? "\n[SISTEMA: O TEXTO ABAIXO FOI CLASSIFICADO COMO CENÁRIO A (DIRETRIZ)]\n" : "";

        // 2. Neutralização do User Prompt (remoção de verbos de comando para evitar viés de sobreposição)
        const userPrompt = `${contextFlag}TEXTO DITADO:\n\n${text}`;

        return await this.generate(INTERNAL_CLEANUP_PROMPT, userPrompt);
    }
}

export const aiService = new GroqLlmService();
