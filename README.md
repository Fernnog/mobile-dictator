# Ditado Digital Pro 🎙️
> **Engenharia de Áudio DSP + Inteligência Artificial + Fluxo "Mouse-Free".**
> *A ferramenta definitiva para transcrição de alta performance com Zero Latência.*

![Status](https://img.shields.io/badge/status-active-success.svg)
![Version](https://img.shields.io/badge/version-1.0.5-blue.svg)
![Technology](https://img.shields.io/badge/tech-Vanilla_JS_%7C_Web_Audio_API_%7C_Gemini_Flash-indigo.svg)

## 📑 Visão Geral do Produto

O **Ditado Digital Pro** é uma aplicação de engenharia de voz *Client-Side*. Diferente de ditadores comuns, ele roda um pipeline otimizado localmente no navegador, desenhado para profissionais que ditam grandes volumes de texto (jurídico, médico, acadêmico).

A versão atual (**v1.0.5**) introduz o conceito de **"High-Fidelity Input"**, forçando o hardware a entregar o sinal de áudio mais limpo possível para o motor de reconhecimento.

---

## 🎧 Decisões de Arquitetura de Áudio (Contexto & Motivação)

*Esta seção visa evitar descontinuidade tecnológica futura, explicando o "porquê" das configurações de captura no `speech-manager.js`.*

O sucesso do reconhecimento de voz (STT) depende 80% da qualidade do sinal de entrada e 20% do algoritmo. Para maximizar a precisão, implementamos as seguintes restrições de hardware (`MediaTrackConstraints`):

### 1. Forçamento de Mono (`channelCount: 1`)
*   **O Problema:** Microfones modernos e headsets USB frequentemente enviam sinais estéreo (2 canais). Se a cápsula do microfone não estiver perfeitamente alinhada, ocorre "Cancelamento de Fase", deixando a voz com som metálico ou abafado.
*   **A Solução:** Forçamos a captura em 1 canal.
*   **Motivação:** A voz humana é uma fonte sonora pontual. O motor de reconhecimento (Google Speech) espera um sinal monofônico limpo. Enviar estéreo duplica o processamento desnecessariamente e introduz artefatos de fase.

### 2. Amostragem em Alta Fidelidade (`sampleRate: 48000`)
*   **O Problema:** O padrão de telefonia é 8kHz ou 16kHz. Isso corta frequências agudas essenciais para distinguir fonemas sibilantes (ex: diferenciar "S", "F" e "X", ou "V" e "B").
*   **A Solução:** Solicitamos 48kHz (padrão de estúdio/DVD).
*   **Motivação:** Aumentar a densidade de dados para a análise espectral (FFT). Com mais amostras por segundo, a IA consegue distinguir melhor as nuances da dicção, reduzindo erros gramaticais fonéticos.

### 3. DSP via Hardware (`NoiseSuppression` & `EchoCancellation`)
*   **Estratégia:** Em vez de processar ruído via JavaScript (o que causaria latência), delegamos essa tarefa ao chip de áudio do dispositivo ou ao motor nativo do navegador. Isso libera a *Main Thread* para focar na renderização da UI e no processamento de texto.

---

## 🚀 Funcionalidades Principais

### 1. Smart Widget (Modo Compacto)
Um modo de "Bloco de Notas Flutuante" para multitarefa.
*   **Dock Completo:** Acesso rápido a Gravar, Copiar, Limpar, IA Jurídica e Correção, mesmo em janela reduzida.
*   **Auto-Scroll:** O texto rola automaticamente para acompanhar sua voz.
*   **Responsividade:** Layout circular otimizado para ocupar o mínimo de pixels na tela.

### 2. Navegação "Mouse-Free" (Atalhos via `Alt`)
Para evitar conflitos com o navegador (onde `Ctrl` fecha abas), usamos a tecla `Alt`.
| Ação | Atalho | Detalhes Técnicos |
| :--- | :--- | :--- |
| **Gravar / Parar** | <kbd>Alt</kbd> + <kbd>G</kbd> | Alterna mic e processamento DSP. |
| **Limpar Texto** | <kbd>Alt</kbd> + <kbd>L</kbd> | Limpa a tela + aciona Backup (Undo). |
| **Copiar Tudo** | <kbd>Alt</kbd> + <kbd>C</kbd> | Copia para Área de Transferência. |
| **Desfazer** | <kbd>Alt</kbd> + <kbd>Z</kbd> | Restaura texto apagado (buffer de 5s). |

### 3. Integração com IA (Gemini Flash)
*   **Revisor Gramatical:** Corrige pontuação e concordância sem alterar o estilo.
*   **Tradutor Jurídico:** Converte linguagem coloquial para termos formais ("Juridiquês").
*   **Glossário Pessoal:** Substituição automática de termos (ex: "Artigo quinto" -> "Art. 5º") definida pelo usuário.

---

## 🛠️ Estrutura de Arquivos

O projeto segue a filosofia **"Vanilla Performance"**: zero frameworks, zero build steps.

```bash
/
├── index.html       # Launcher (Cálculo de posicionamento Smart Docking)
├── app.html         # Aplicação Principal (UI, Canvas, Modais)
├── style.css        # Design System (Variáveis, Modo Minimized, Toasts)
├── js/
│   ├── main.js      # Core Controller (Events, UI Logic, Undo System)
│   ├── config.js    # Constantes globais e chaves de Storage
│   ├── hotkeys.js   # Gerenciador de eventos de teclado
│   ├── changelog.js # Dados do histórico de versões
│   ├── speech-manager.js # [CRÍTICO] Engine de Áudio + Web Speech API + Configs de Hardware
│   ├── glossary.js  # Módulo de substituição de termos
│   └── gemini-service.js # Integração com Google AI
└── README.md        # Documentação Técnica

```

## ⚡ Como Usar

### Instalação
Não requer instalação (Client-Side Only).
1. Baixe a pasta do projeto.
2. Abra o arquivo `index.html` no Google Chrome ou Edge (Navegadores Chromium são obrigatórios para suporte total à Web Speech API).
3. Clique em **"Iniciar Widget"**.

### Configuração da IA
O sistema pedirá sua **API Key** na primeira tentativa de uso dos recursos de IA.
1. Obtenha gratuitamente no [Google AI Studio](https://aistudio.google.com/app/apikey).
2. A chave é salva localmente no navegador.

---

## 🔒 Privacidade e Segurança

*   **Processamento Local:** O reconhecimento de voz ocorre no motor do navegador.
*   **Dados da IA:** Seus textos são enviados para a API do Google Gemini **apenas** sob demanda (clique no botão).
*   **Persistência:** O texto é salvo no `localStorage`.
*   **Backup Temporário:** O sistema de "Undo" mantém o texto apagado na memória RAM apenas por 5 segundos.

---

> **Desenvolvido com foco em Engenharia de Produto.**
> *Versão 1.0.5 - High Fidelity Audio Build*
