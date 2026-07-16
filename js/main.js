import { SpeechManager } from './speech-manager.js';
import { aiService, EXTERNAL_LEGAL_PROMPT } from './llm-service.js';
import Glossary from './glossary.js';
import { CONFIG } from './config.js';
import { HotkeyManager } from './hotkeys.js';

// Referência à janela flutuante (somente para o caminho window.open/fallback)
let activeExternalWindow = null;

// [NOVO] Referência à janela PiP ativa (Caminho A).
let activePipWindow = null;

// [NOVO] Contador de sessão PiP. Incrementado a cada reopen programático.
// Cada handler pagehide captura o ID do momento em que FOI REGISTRADO.
// Se o ID global avançou, o pagehide é de um pip antigo — ignorar restauração.
let _pipSessionId = 0;

// [NOVO] Memoriza a posição do widget de microfone antes de cada expansão.
// Permite que transitionToMicState() retorne ao ponto exato onde o usuário
// havia posicionado o microfone, em vez da posição padrão ou da janela de ação.
let lastMicPosition = { x: null, y: null };

// ========================================================
// 1. REFERÊNCIAS DE UI (DOM Elements)
// ========================================================
const ui = {
    // Área Principal
    textarea: document.getElementById('transcriptionArea'),
    charCount: document.getElementById('charCount'),
    miniVisualizer: document.getElementById('miniVisualizer'),
    statusMsg: document.getElementById('statusMsg'),
    
    // Controles Principais
    micBtn: document.getElementById('micBtn'),
    audioSource: document.getElementById('audioSource'),
    
    // Controle de Motor
    engineToggle: document.getElementById('engineToggle'),
    engineLabel: document.getElementById('engineLabel'),
    
    // Botões de Ação
    exportBtn: document.getElementById('exportBtn'),
    btnAiFix: document.getElementById('aiFixBtn'),
    btnAiLegal: document.getElementById('aiLegalBtn'),
    btnCopy: document.getElementById('copyBtn'),
    btnClear: document.getElementById('clearBtn'),
    
    // Modais e Auxiliares
    toggleSizeBtn: document.getElementById('toggleSizeBtn'),
    container: document.getElementById('appContainer'),
    helpBtn: document.getElementById('helpBtn'),
    toastContainer: document.getElementById('toastContainer'),

    // Glossário
    glossaryBtn: document.getElementById('glossaryBtn'),
    glossaryModal: document.getElementById('glossaryModal'),
    closeGlossaryBtn: document.getElementById('closeGlossaryBtn'),
    glossaryList: document.getElementById('glossaryList'),
    termInput: document.getElementById('termInput'),
    replaceInput: document.getElementById('replaceInput'),
    addTermBtn: document.getElementById('addTermBtn'),

   // [NOVO] Modo Foco e PWA
    focusModeBtn: document.getElementById('focusModeBtn'),
    installPwaBtn: document.getElementById('installPwaBtn'),
    popOutBottomBtn: document.getElementById('popOutBottomBtn'),

    // [INSERIR] Elemento fantasma para o Drag & Drop
    dragImage:      document.getElementById('dragImage'),

    // [INSERIR] Placeholder de estado do modo PiP
    pipPlaceholder: document.getElementById('pipPlaceholder')
};

// Variáveis de Estado
let undoTimeout = null;
let tempDeletedText = '';

// ============================================================
// UTILITÁRIO DE REPOSICIONAMENTO — EXECUÇÃO INTERNA NA JANELA PiP
//
// POR QUE INJEÇÃO DE SCRIPT?
// O Chrome trata chamadas moveTo() de forma diferente dependendo
// do contexto de execução:
//
//   - EXTERNO (aba principal → activePipWindow.moveTo()):
//     O Chrome silencia a instrução, pois a janela PiP é gerenciada
//     pelo sistema de Picture-in-Picture do navegador, que rejeita
//     reposicionamentos de contextos externos após a animação inicial.
//
//   - INTERNO (window.moveTo() de dentro da própria janela PiP):
//     O Chrome reconhece a instrução como legítima e executa o
//     reposicionamento.
//
// A solução é criar um <script> no documento da janela PiP para
// que o moveTo() seja chamado a partir do contexto correto.
//
// DIAGNÓSTICO ATIVO: Esta função emite logs no console (F12).
// Abra o DevTools ANTES de clicar nos botões para ver:
//   - As coordenadas calculadas para cada canto
//   - A posição real da janela a cada tentativa
//   - Se a chegada foi confirmada ou o limite atingido
// Esses logs podem ser removidos após a validação.
//
// @param {Window} win         - Referência à janela PiP.
// @param {number} targetLeft  - Coordenada X desejada (px).
// @param {number} targetTop   - Coordenada Y desejada (px).
// ============================================================
function injectMoveScript(win, targetLeft, targetTop) {
    if (!win || win.closed) return;

    // [DIAGNÓSTICO] Log no console da aba principal — confirma os valores calculados
    console.log(
        '[PiP] injectMoveScript chamado.' +
        '\n  Alvo → left: ' + targetLeft + 'px, top: ' + targetTop + 'px' +
        '\n  Tela (aba principal) → availLeft: ' + window.screen.availLeft +
        ', availTop: ' + window.screen.availTop +
        ', availWidth: ' + window.screen.availWidth +
        ', availHeight: ' + window.screen.availHeight
    );

    try {
        // Serializa os valores como inteiros para uso seguro dentro do script injetado
        const x   = targetLeft | 0;
        const y   = targetTop  | 0;
        const max = 8;    // tentativas máximas (8 × 150ms = 1200ms de janela)
        const ms  = 150;  // intervalo entre tentativas em ms
        const tol = 32;   // tolerância de posição em pixels (cobre variações de DPI)

        const script = win.document.createElement('script');
        script.textContent = `
(function() {
  var x = ${x}, y = ${y}, max = ${max}, tol = ${tol}, n = 0;
  console.log('[PiP Interno] Script injetado. Alvo: left=' + x + 'px, top=' + y + 'px');
  var t = setInterval(function() {
    window.moveTo(x, y);
    console.log(
      '[PiP Interno] Tentativa ' + (n + 1) + '/' + max +
      ' | screenX=' + window.screenX + ', screenY=' + window.screenY +
      ' | alvo: left=' + x + ', top=' + y
    );
    n++;
    var chegou = Math.abs(window.screenX - x) <= tol
              && Math.abs(window.screenY - y) <= tol;
    if (chegou) {
      console.log('[PiP Interno] Posicao confirmada na tentativa ' + n + '. Loop encerrado.');
      clearInterval(t);
    } else if (n >= max) {
      console.warn(
        '[PiP Interno] Limite de tentativas atingido sem confirmar posicao.' +
        ' Posicao final: screenX=' + window.screenX + ', screenY=' + window.screenY
      );
      clearInterval(t);
    }
  }, ${ms});
})();
        `.trim();

        win.document.head.appendChild(script);

    } catch (err) {
        // Fallback: se a injeção for bloqueada (ex: CSP restritiva no servidor),
        // tenta o moveTo() externo como último recurso.
        console.warn('[PiP] Injeção de script bloqueada. Tentando moveTo() externo (fallback):', err);
        _externalMoveTo(win, targetLeft, targetTop);
    }
}

/**
 * Fallback de último recurso: chama moveTo() do contexto externo (aba principal).
 * Ativado apenas se injectMoveScript() falhar por restrição de CSP.
 * Mantido como segurança — não é o caminho principal.
 */
function _externalMoveTo(win, targetLeft, targetTop) {
    let attempts = 0;
    const timer = setInterval(() => {
        if (!win || win.closed) { clearInterval(timer); return; }
        try { win.moveTo(targetLeft, targetTop); } catch (_) {}
        attempts++;
        let sx, sy;
        try { sx = win.screenX; sy = win.screenY; } catch (_) { sx = null; sy = null; }
        const arrived = sx !== null
            && Math.abs(sx - targetLeft) <= 32
            && Math.abs(sy - targetTop)  <= 32;
        if (arrived || attempts >= 8) clearInterval(timer);
    }, 150);
}

// ============================================================
// GERENCIADOR DE ESTADOS DA JANELA FLUTUANTE
// Controla as transições entre Estado Mic e Estado Ação.
// ============================================================

/**
 * Retorna true se o container estiver atualmente dentro de
 * uma janela flutuante (PiP ou popup window.open).
 */
function isInFloatingWindow() {
    const pipWin = (typeof documentPictureInPicture !== 'undefined')
        ? documentPictureInPicture?.window
        : null;
    if (pipWin && pipWin.document === ui.container.ownerDocument) return true;
    if (activeExternalWindow) return true;
    return false;
}

/**
 * Clona todas as folhas de estilo da aba principal para uma janela PiP.
 * @param {Window} pipWin - A janela PiP de destino.
 */
function cloneStylesToPipWindow(pipWin) {
    [...document.styleSheets].forEach((sheet) => {
        try {
            const rules = [...sheet.cssRules].map(r => r.cssText).join('');
            const style = pipWin.document.createElement('style');
            style.textContent = rules;
            pipWin.document.head.appendChild(style);
        } catch (_e) {
            if (sheet.href) {
                const link = pipWin.document.createElement('link');
                link.rel  = 'stylesheet';
                link.href = sheet.href;
                pipWin.document.head.appendChild(link);
            }
        }
    });
}

/**
 * Abre uma janela Document PiP com as dimensões especificadas,
 * transfere o container, clona os estilos e registra o pagehide.
 * As classes CSS do container devem ser configuradas ANTES de chamar esta função.
 * @param {number} width  - Largura desejada em pixels.
 * @param {number} height - Altura desejada em pixels.
 * @returns {Promise<Window>} A janela PiP recém-aberta.
 */
async function openPipWindow(width, height) {
    const pipWin = await documentPictureInPicture.requestWindow({
        width,
        height,
        disallowReturnToOpener: false
    });
    activePipWindow = pipWin;

    const capturedSessionId = _pipSessionId;

    cloneStylesToPipWindow(pipWin);
    pipWin.document.body.classList.add('is-pip-mode');
    pipWin.document.body.appendChild(ui.container);

    // [CORREÇÃO 1A] Restaura a opacidade do container após a transferência.
    ui.container.style.opacity = '';

    // [CORREÇÃO 1B] Reinicia o loop de animação do visualizador de áudio.
    if (typeof speechManager !== 'undefined' && speechManager?.refreshVisualizer) {
        requestAnimationFrame(() => speechManager.refreshVisualizer());
    }

    pipWin.addEventListener('pagehide', () => {
        // [CORREÇÃO 1C] Guarda de identidade.
        if (activePipWindow === pipWin) activePipWindow = null;

        if (_pipSessionId !== capturedSessionId) return;

        // Fechamento manual pelo usuário — restaurar normalmente.
        if (ui.pipPlaceholder) ui.pipPlaceholder.style.display = 'none';
        document.body.appendChild(ui.container);
        ui.container.classList.remove('minimalist-mode', 'minimized');
        ui.container.style.opacity = '';
        setUIMode(false);
        requestAnimationFrame(() => {
            if (ui.textarea) ui.textarea.scrollTop = ui.textarea.scrollHeight;
        });
    });

    return pipWin;
}

/**
 * Estado Mic → Estado Ação.
 * Ativado quando a transcrição retorna texto.
 */
async function transitionToActionState() {
    if (!ui.container.classList.contains('minimalist-mode')) return;

    const currentWin = activeExternalWindow || activePipWindow;
    if (currentWin) {
        lastMicPosition.x = currentWin.screenX;
        lastMicPosition.y = currentWin.screenY;
    }

    ui.container.classList.remove('minimalist-mode');
    ui.container.classList.add('minimized');

    // ── CAMINHO B: popup window.open ─────────────────────────────────────────
    if (activeExternalWindow) {
        try {
            const { ACTION_W: W, ACTION_H: H } = CONFIG.UI.WINDOW;
            const cx = activeExternalWindow.screenX + (activeExternalWindow.outerWidth  / 2);
            const cy = activeExternalWindow.screenY + (activeExternalWindow.outerHeight / 2);
            activeExternalWindow.resizeTo(W, H);
            activeExternalWindow.moveTo(cx - W / 2, cy - H / 2);
        } catch (e) {
            console.warn('resizeTo Caminho B (Ação) bloqueado:', e);
        }
        requestAnimationFrame(() => {
            if (ui.textarea) ui.textarea.scrollTop = ui.textarea.scrollHeight;
        });
        return;
    }

    // ── CAMINHO A: Document PiP ── Estratégia de Reopen ──────────────────────
    if (activePipWindow) {
        try {
            const { ACTION_W: W, ACTION_H: H } = CONFIG.UI.WINDOW;
            const prevX = activePipWindow.screenX;
            const prevY = activePipWindow.screenY;

            ui.container.style.opacity = '0';
            _pipSessionId++;
            document.body.appendChild(ui.container);
            activePipWindow.close();
            await new Promise(r => setTimeout(r, 80));
            await openPipWindow(W, H);

            // Reposiciona via injeção interna — único método confiável no Chrome
            injectMoveScript(activePipWindow, prevX, prevY);

            requestAnimationFrame(() => {
                if (ui.textarea) ui.textarea.scrollTop = ui.textarea.scrollHeight;
            });
        } catch (e) {
            console.warn('Reopen PiP (Ação) falhou:', e);
            ui.container.style.opacity = '';
            if (ui.pipPlaceholder) ui.pipPlaceholder.style.display = 'none';
            document.body.appendChild(ui.container);
            ui.container.classList.remove('minimalist-mode', 'minimized');
            setUIMode(false);
        }
    }
}

/**
 * Estado Ação → Estado Mic.
 * Ativado pelo botão "Limpar". Só executa dentro de uma janela flutuante.
 */
async function transitionToMicState() {
    if (!isInFloatingWindow()) return;
    if (!ui.container.classList.contains('minimized')) return;

    ui.container.classList.remove('minimized');
    ui.container.classList.add('minimalist-mode');

    // ── CAMINHO B: popup window.open ─────────────────────────────────────────
    if (activeExternalWindow) {
        try {
            const { MIC_W: W, MIC_H: H } = CONFIG.UI.WINDOW;
            activeExternalWindow.resizeTo(W, H);

            if (lastMicPosition.x !== null && lastMicPosition.y !== null) {
                activeExternalWindow.moveTo(lastMicPosition.x, lastMicPosition.y);
            } else {
                const cx = activeExternalWindow.screenX + (activeExternalWindow.outerWidth  / 2);
                const cy = activeExternalWindow.screenY + (activeExternalWindow.outerHeight / 2);
                activeExternalWindow.moveTo(cx - W / 2, cy - H / 2);
            }
        } catch (e) {
            console.warn('resizeTo Caminho B (Mic) bloqueado:', e);
        }
        return;
    }

    // ── CAMINHO A: Document PiP ── Estratégia de Reopen ──────────────────────
    if (activePipWindow) {
        try {
            const { MIC_W: W, MIC_H: H } = CONFIG.UI.WINDOW;

            const targetX = lastMicPosition.x !== null ? lastMicPosition.x : activePipWindow.screenX;
            const targetY = lastMicPosition.y !== null ? lastMicPosition.y : activePipWindow.screenY;

            ui.container.style.opacity = '0';
            _pipSessionId++;
            document.body.appendChild(ui.container);
            activePipWindow.close();
            await new Promise(r => setTimeout(r, 80));
            await openPipWindow(W, H);

            // Reposiciona via injeção interna — garante que os ciclos Ação ↔ Mic
            // retornem ao canto correto (superior ou inferior) ao longo de toda a sessão.
            injectMoveScript(activePipWindow, targetX, targetY);

        } catch (e) {
            console.warn('Reopen PiP (Mic) falhou:', e);
            ui.container.style.opacity = '';
            if (ui.pipPlaceholder) ui.pipPlaceholder.style.display = 'none';
            document.body.appendChild(ui.container);
            ui.container.classList.remove('minimalist-mode', 'minimized');
            setUIMode(false);
        }
    }
}

// ========================================================
// 2. WAKE LOCK (Modo Insônia)
// ========================================================
let wakeLock = null;
const toggleWakeLock = async (shouldLock) => {
    if ('wakeLock' in navigator) {
        try {
            if (shouldLock && !wakeLock) {
                wakeLock = await navigator.wakeLock.request('screen');
            } else if (!shouldLock && wakeLock) {
                await wakeLock.release();
                wakeLock = null;
            }
        } catch (err) {
            console.warn('Wake Lock não disponível:', err);
        }
    }
};

document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        try { wakeLock = await navigator.wakeLock.request('screen'); } catch(e){}
    }
});

// ========================================================
// 3. GLOSSÁRIO (Instanciação do Módulo)
// ========================================================
const glossaryManager = new Glossary((terms) => {
    if (!ui.glossaryList) return;
    ui.glossaryList.innerHTML = '';
    
    if (terms.length === 0) {
        ui.glossaryList.innerHTML = '<p style="color:#9ca3af; text-align:center;">Nenhum termo cadastrado.</p>';
        return;
    }

    terms.forEach((term, index) => {
        const div = document.createElement('div');
        div.className = 'glossary-item';
        div.innerHTML = `
            <span class="term-pair">
                <span class="term-from">${term.from}</span>
                <span class="term-arrow">➜</span>
                <span class="term-to">${term.to}</span>
            </span>
            <button class="btn-delete-term" data-index="${index}">&times;</button>
        `;
        ui.glossaryList.appendChild(div);
    });

    document.querySelectorAll('.btn-delete-term').forEach(btn => {
        btn.addEventListener('click', (e) => {
            glossaryManager.remove(parseInt(e.target.dataset.index));
        });
    });
});

// ========================================================
// 4. AUXILIARES VISUAIS & SEGURANÇA
// ========================================================

async function unifiedClipboardCopy(textToCopy, buttonElement) {
    const targetWindow = ui.textarea.ownerDocument.defaultView;
    try {
        await targetWindow.navigator.clipboard.writeText(textToCopy);
    } catch (primaryError) {
        // Fallback cross-browser
        const targetDocument = ui.textarea.ownerDocument;
        const tempArea = targetDocument.createElement('textarea');
        tempArea.value = textToCopy;
        tempArea.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
        targetDocument.body.appendChild(tempArea);
        tempArea.focus();
        tempArea.select();
        try { targetDocument.execCommand('copy'); } catch (fallbackError) {
            console.warn('[Clipboard] Fallback falhou:', fallbackError);
        } finally {
            targetDocument.body.removeChild(tempArea);
        }
    }

    // Feedback Visual Padronizado
    if (buttonElement) {
        const span = buttonElement.querySelector('span');
        const originalText = span ? span.textContent : '';
        if (span) span.textContent = 'Copiado!';
        
        // Remove classes antigas mortas (se existirem) e aplica a nova
        buttonElement.classList.remove('status-success'); 
        buttonElement.classList.add('copy-success', 'pulsing');

        setTimeout(() => {
            if (span) span.textContent = originalText;
            buttonElement.classList.remove('copy-success', 'pulsing');
        }, 1500); // 1.5s padrão
    }
}

const stopVisualEffects = () => {
    [ui.micBtn, ui.btnAiLegal, ui.btnAiFix, ui.btnCopy, ui.btnClear].forEach(btn => {
        if(btn) btn.classList.remove('pulsing');
    });
};

const executeSafely = async (actionCallback) => {
    ui.toastContainer.innerHTML = ''; 
    if (undoTimeout) clearTimeout(undoTimeout);

    if (speechManager && speechManager.isRecording) {
        speechManager.stop();
        toggleWakeLock(false);
        const originalColor = ui.micBtn.style.backgroundColor;
        ui.micBtn.style.backgroundColor = '#f59e0b'; 
        await new Promise(resolve => setTimeout(resolve, 300));
        ui.micBtn.style.backgroundColor = '';
    }
    stopVisualEffects();
    actionCallback();
};

// ========================================================
// 5. CALLBACKS DO SPEECH MANAGER
// ========================================================
const handleTranscriptionResult = (finalText, interimText) => {
    if (finalText) {
        const processedText = glossaryManager.process(finalText);
        
        const start = ui.textarea.selectionStart;
        const end = ui.textarea.selectionEnd;
        const text = ui.textarea.value;
        const before = text.substring(0, start);
        const after = text.substring(end, text.length);
        const prefix = (before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n')) ? ' ' : '';
        
        ui.textarea.value = before + prefix + processedText + after;
        
        const newCursorPos = start + prefix.length + processedText.length;
        ui.textarea.setSelectionRange(newCursorPos, newCursorPos);
        
        saveContent();
        updateCharCount();

       if (ui.container.classList.contains('minimized')) {
            ui.textarea.scrollTop = ui.textarea.scrollHeight;
        }

        transitionToActionState();
    }
};

const updateStatus = (status) => {
    ui.statusMsg.className = 'status-bar';
    ui.micBtn.style.backgroundColor = ''; 

    if (status === 'starting') {
        ui.statusMsg.textContent = "CONECTANDO...";
        ui.statusMsg.classList.add('active', 'status-starting');
        ui.micBtn.style.backgroundColor = '#eab308'; 
        ui.micBtn.classList.add('pulsing');
    } else if (status === 'recording') {
        ui.statusMsg.textContent = "GRAVANDO";
        ui.statusMsg.classList.add('active', 'status-recording');
        ui.micBtn.classList.add('recording', 'pulsing');
    } else if (status === 'processing') {
        ui.statusMsg.textContent = "PROCESSANDO IA...";
        ui.statusMsg.classList.add('active', 'status-ai');
    } else if (status === 'error') {
        ui.statusMsg.textContent = "ERRO / BLOQUEADO";
        ui.statusMsg.classList.add('active', 'status-error');
        ui.micBtn.classList.remove('recording');
        stopVisualEffects(); 
        toggleWakeLock(false);
    } else {
        ui.statusMsg.textContent = "";
        ui.statusMsg.classList.remove('active');
        ui.micBtn.classList.remove('recording', 'pulsing'); 
    }
};

const speechManager = new SpeechManager('audioVisualizer', handleTranscriptionResult, updateStatus);

// ========================================================
// 6. SELETOR DE DISPOSITIVOS
// ========================================================
async function initDeviceSelector() {
    const populate = (devices) => {
        ui.audioSource.innerHTML = '<option value="default">Padrão do Sistema</option>';
        const savedId = localStorage.getItem(CONFIG.STORAGE_KEYS.MIC);
        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Microfone (${device.deviceId.slice(0,5)}...)`;
            if (device.deviceId === savedId) option.selected = true;
            ui.audioSource.appendChild(option);
        });
        if (savedId) speechManager.setDeviceId(savedId);
    };

    const devices = await speechManager.getAudioDevices();
    populate(devices);
    speechManager.listenToDeviceChanges((updatedDevices) => populate(updatedDevices));

    ui.audioSource.addEventListener('change', (e) => {
        const val = e.target.value;
        speechManager.setDeviceId(val);
        localStorage.setItem(CONFIG.STORAGE_KEYS.MIC, val);
    });
}

// ========================================================
// 7. EVENT LISTENERS
// ========================================================

ui.micBtn.addEventListener('click', () => {
    if (speechManager.isRecording) {
        speechManager.stop();
        toggleWakeLock(false);
    } else {
        ui.toastContainer.innerHTML = ''; 
        if (undoTimeout) clearTimeout(undoTimeout);
        stopVisualEffects(); 
        updateStatus('starting'); 
        speechManager.start();
        toggleWakeLock(true);
    }
});

// [NOVO] Toggle do Modo Foco
if (ui.focusModeBtn) {
    ui.focusModeBtn.addEventListener('click', () => {
        ui.container.classList.toggle('focus-mode');
        ui.textarea.scrollTop = ui.textarea.scrollHeight;
    });
}

if (ui.engineToggle) {
    ui.engineToggle.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        localStorage.setItem('dd_engine_pref', isChecked ? 'whisper' : 'native');
        if (ui.engineLabel) ui.engineLabel.textContent = isChecked ? 'Whisper AI' : 'Nativo';
        speechManager.useWhisper = isChecked;
    });
}

if (ui.exportBtn) {
    ui.exportBtn.addEventListener('click', () => {
        const text = ui.textarea.value.trim();
        if (!text) {
            alert("Não há texto para exportar.");
            return;
        }
        
        // Animação de feedback no botão
        ui.exportBtn.classList.add('pulsing');
        
        // Geração do arquivo TXT e download automático
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        const dateStr = new Date().toISOString().slice(0, 10);
        a.download = `Ditado_Digital_${dateStr}.txt`;
        
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        setTimeout(() => ui.exportBtn.classList.remove('pulsing'), 1000);
    });
}

ui.btnAiFix.addEventListener('click', () => {
    const text = ui.textarea.value.trim();
    if (!text) return alert("Digite ou dite algo primeiro.");

    executeSafely(async () => {
        stopVisualEffects();
        ui.btnAiFix.classList.add('pulsing');
        updateStatus('processing');
        try {
            const result = await aiService.fixGrammar(text);
            ui.textarea.value = result;
            saveContent();
            updateStatus('');
        } catch (error) {
            alert("Erro na IA (Llama/Groq): " + error.message);
            updateStatus('error');
            setTimeout(() => updateStatus(''), 2000);
        } finally {
            ui.btnAiFix.classList.remove('pulsing');
        }
    });
});

ui.btnAiLegal.addEventListener('click', () => {
    const text = ui.textarea.value.trim();
    if (!text) return alert("Digite ou dite algo primeiro.");

    executeSafely(async () => {
        stopVisualEffects();
        ui.btnAiLegal.classList.add('pulsing'); 
        
        // Novo status refletindo a nova função
        ui.statusMsg.textContent = "PREPARANDO DIRETRIZ...";
        ui.statusMsg.classList.add('active', 'status-ai');
        
        try {
            // 1. A IA interna limpa a gagueira/gramática das diretrizes ditadas
            const result = await aiService.convertToLegal(text);
            ui.textarea.value = result;
            saveContent();
            updateStatus('');
            
            // 2. Concatena o PROMPT EXTERNO (ordem) + DIRETRIZES LIMPAS
            const finalPayload = `${EXTERNAL_LEGAL_PROMPT}\n\n[MINHAS DIRETRIZES E CONTEXTO]\n\n${result}`;
            await unifiedClipboardCopy(finalPayload, ui.btnAiLegal);
            
        } catch (error) {
            alert("Erro ao preparar diretriz: " + error.message);
            updateStatus('error');
        } finally {
            ui.btnAiLegal.classList.remove('pulsing'); 
            setTimeout(() => updateStatus('idle'), 2000);
        }
    });
});

ui.btnCopy.addEventListener('click', () => {
    executeSafely(async () => {
        stopVisualEffects();
        await unifiedClipboardCopy(ui.textarea.value, ui.btnCopy);
    });
});

// -------------------------------------------------------
// DRAG & DROP — Transferência de texto para apps externos
// -------------------------------------------------------
const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

if (supportsHover) {
    ui.btnCopy.setAttribute('draggable', 'true');

    ui.btnCopy.addEventListener('dragstart', (e) => {
        const textToDrag = ui.textarea.value.trim();

        if (!textToDrag) {
            e.preventDefault();
            return;
        }

        e.dataTransfer.setData('text/plain', textToDrag);
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setDragImage(ui.dragImage, 0, 0);
    });

    ui.btnCopy.addEventListener('dragend', (e) => {
        if (e.dataTransfer.dropEffect === 'none') {}
    });
}

ui.btnClear.addEventListener('click', () => executeSafely(() => handleClearAction()));

function handleClearAction() {
    if (!ui.textarea.value) return;
    tempDeletedText = ui.textarea.value;
    ui.textarea.value = '';
    saveContent();
    updateCharCount();

    if (!isInFloatingWindow()) {
        showUndoToast();
    }

    transitionToMicState();
}

function showUndoToast() {
    ui.toastContainer.innerHTML = '';
    const isCompact = ui.container.classList.contains('minimized');
    
    if (isCompact) {
        ui.toastContainer.classList.add('compact-mode');
    } else {
        ui.toastContainer.classList.remove('compact-mode');
    }

    if (isCompact) {
        const btn = document.createElement('button');
        btn.className = 'btn-undo-float';
        btn.setAttribute('data-tooltip', 'Desfazer (Alt+Z)');
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 7"/></svg>`;
        btn.addEventListener('click', performUndo);
        ui.toastContainer.appendChild(btn);
    } else {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `<span>Texto limpo.</span><button id="undoBtn" class="btn-undo">Desfazer (Alt+Z)</button>`;
        ui.toastContainer.appendChild(toast);
        document.getElementById('undoBtn').addEventListener('click', performUndo);
    }

    if (undoTimeout) clearTimeout(undoTimeout);
    undoTimeout = setTimeout(() => {
        const element = ui.toastContainer.firstElementChild;
        if (element) {
            element.style.opacity = '0';
            element.style.transform = isCompact ? 'scale(0)' : 'translateY(20px)';
            setTimeout(() => ui.toastContainer.innerHTML = '', 300);
        }
        tempDeletedText = '';
    }, 5000);
}

function performUndo() {
    if (tempDeletedText) {
        ui.textarea.value = tempDeletedText;
        saveContent();
        updateCharCount();
        
        ui.textarea.scrollTop = ui.textarea.scrollHeight;
        ui.textarea.focus();

        ui.toastContainer.innerHTML = '';
        tempDeletedText = '';
        if (undoTimeout) clearTimeout(undoTimeout);
    }
}

// ========================================================
// 8. REDIMENSIONAMENTO E ESTADO DA JANELA
// ========================================================

function setUIMode(isMinimized) {
    if (isMinimized) {
        ui.container.classList.add('minimized');
    } else {
        ui.container.classList.remove('minimized');
    }

    const iconMinimize = ui.container.querySelector('#iconMinimize');
    const iconMaximize = ui.container.querySelector('#iconMaximize');

    if (iconMinimize) {
        iconMinimize.classList.toggle('icon-hidden', isMinimized);
    }
    if (iconMaximize) {
        iconMaximize.classList.toggle('icon-hidden', !isMinimized);
    }

    const isPip = !!window.documentPictureInPicture?.window;
    const isOwnPopup = (activeExternalWindow === window);
    
    if (window.outerWidth && !isPip && !isOwnPopup) {
        const targetWidth = isMinimized ? 360 : 1080; 
        const targetHeight = isMinimized ? 500 : 800; 

        try {
            const screenLeft = window.screen.availLeft || 0;
            const screenTop = window.screen.availTop || 0;
            const screenW = window.screen.availWidth;
            const screenH = window.screen.availHeight;

            const left = (screenLeft + screenW) - targetWidth - 20;
            const top = (screenTop + screenH) - targetHeight - 20;

            window.resizeTo(targetWidth, targetHeight);
            window.moveTo(left, top);
        } catch (e) {
            console.warn("Navegador bloqueou resizeTo.", e);
        }
    }
    
    if (isMinimized) {
        setTimeout(() => {
            ui.textarea.scrollTop = ui.textarea.scrollHeight;
        }, 100);
    }
}

ui.toggleSizeBtn.addEventListener('click', () => {
    const pipWindow = window.documentPictureInPicture?.window;
    if (pipWindow && ui.toggleSizeBtn.ownerDocument === pipWindow.document) {
        pipWindow.close();
        return;
    }

    const isCurrentlyMinimized = ui.container.classList.contains('minimized');
    setUIMode(!isCurrentlyMinimized);
});

// ========================================================
// 9. STARTUP
// ========================================================
function updateCharCount() {
    ui.charCount.textContent = `${ui.textarea.value.length} caracteres`;
}

function saveContent() {
    localStorage.setItem(CONFIG.STORAGE_KEYS.TEXT, ui.textarea.value);
}

function loadContent() {
    const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.TEXT);
    if (saved) {
        ui.textarea.value = saved;
        updateCharCount();
    }
}

if (ui.glossaryBtn && ui.glossaryModal) {
    ui.glossaryBtn.addEventListener('click', () => {
        glossaryManager.renderCallback(glossaryManager.getTerms()); 
        ui.glossaryModal.style.display = 'flex';
    });
    ui.closeGlossaryBtn.addEventListener('click', () => ui.glossaryModal.style.display = 'none');
    ui.addTermBtn.addEventListener('click', () => {
        glossaryManager.add(ui.termInput.value, ui.replaceInput.value);
        ui.termInput.value = '';
        ui.replaceInput.value = '';
    });
}

window.addEventListener('DOMContentLoaded', () => {
    loadContent();
    initDeviceSelector();

    if (ui.engineToggle) {
        const savedEngine = localStorage.getItem('dd_engine_pref') || 'native';
        const isWhisper = savedEngine === 'whisper';
        ui.engineToggle.checked = isWhisper;
        if (ui.engineLabel) ui.engineLabel.textContent = isWhisper ? 'Whisper AI' : 'Nativo';
        if (speechManager) speechManager.useWhisper = isWhisper;
    }

    new HotkeyManager(ui, {
        triggerClear: () => executeSafely(() => handleClearAction()),
        triggerUndo: performUndo
    });

    const _isMobile     = window.matchMedia('(max-width: 768px)').matches;
    const _isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const _isPopup      = !!window.opener;
    const _canUsePiP    = 'documentPictureInPicture' in window;

    if (!_isMobile && !_isStandalone && !_isPopup) {
        document.body.classList.add('is-desktop-tab');
    }

    // ============================================================
    // MODO COMPACTO — Controle Direcional (Superior ou Inferior)
    //
    // Caminho A (Document PiP, Chrome 116+):
    //   - injectMoveScript() injeta o reposicionamento no contexto
    //     interno da janela PiP — única forma confiável de chamar
    //     moveTo() no Chrome, pois chamadas externas são ignoradas.
    //   - lastMicPosition pré-populado para preservar o canto correto
    //     nos ciclos Ação ↔ Mic subsequentes.
    //
    // Caminho B (window.open — fallback Firefox/Safari/Edge):
    //   - left/top passados diretamente na string de features.
    // ============================================================

    const setupCompactModeLaunch = (btnElement, positionTarget) => {
        if (!btnElement) return;

        const calcTargetPosition = () => {
            const { MIC_W: W, MIC_H: H } = CONFIG.UI.WINDOW;
            const screenLeft = window.screen.availLeft ?? 0;
            const screenTop  = window.screen.availTop  ?? 0;
            const targetLeft = (screenLeft + window.screen.availWidth) - W - 16;
            const targetTop  = positionTarget === 'top'
                ? screenTop + 16
                : (screenTop + window.screen.availHeight) - H - 16;
            return { W, H, targetLeft, targetTop };
        };

        /** CAMINHO A: Document Picture-in-Picture */
        const handlePiP = async () => {
            const { W, H, targetLeft, targetTop } = calcTargetPosition();

            lastMicPosition = { x: targetLeft, y: targetTop };

            try {
                ui.container.classList.remove('minimized');
                ui.container.classList.add('minimalist-mode');
                if (ui.pipPlaceholder) ui.pipPlaceholder.style.display = 'flex';

                await openPipWindow(W, H);

                // Injeta o script de reposicionamento no contexto interno
                // da janela PiP — contorna a restrição do Chrome que ignora
                // chamadas moveTo() vindas de contextos externos.
                injectMoveScript(activePipWindow, targetLeft, targetTop);

            } catch (err) {
                ui.container.classList.remove('minimalist-mode');
                if (ui.pipPlaceholder) ui.pipPlaceholder.style.display = 'none';

                console.warn('Document PiP bloqueado:', err);
                ui.statusMsg.textContent = 'Permissão de janela negada pelo navegador.';
                ui.statusMsg.className   = 'status-bar active status-warning';
                setTimeout(() => {
                    ui.statusMsg.textContent = '';
                    ui.statusMsg.className   = 'status-bar';
                }, 4000);
            }
        };

        /** CAMINHO B: window.open (fallback) */
        const handleWindowOpen = () => {
            const { W, H, targetLeft, targetTop } = calcTargetPosition();
            window.open(
                window.location.pathname + '?mode=compact-mic',
                'DitadoWidget',
                `width=${W},height=${H},left=${targetLeft},top=${targetTop},popup=yes,` +
                `resizable=yes,scrollbars=no,toolbar=no,menubar=no,status=no`
            );
        };

        btnElement.addEventListener('click', _canUsePiP ? handlePiP : handleWindowOpen);
    };

    setupCompactModeLaunch(ui.popOutBottomBtn, 'bottom');

    // ── Detecção de contexto via parâmetro URL ────────────────────
    const urlParams = new URLSearchParams(window.location.search);

    if (urlParams.get('mode') === 'compact') {
        setTimeout(() => {
            if (!ui.container.classList.contains('minimized')) {
                ui.toggleSizeBtn.click();
            }
        }, 100);
    }

    if (urlParams.get('mode') === 'compact-mic') {
        document.body.classList.add('is-pip-mode');
        activeExternalWindow = window;
        setTimeout(() => {
            ui.container.classList.remove('minimized');
            ui.container.classList.add('minimalist-mode');
        }, 150);
    }
});

// ========================================================
// 10. LÓGICA DE INSTALAÇÃO PWA
// ========================================================
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.body.classList.add('show-install-btn');
});

if (ui.installPwaBtn) {
    ui.installPwaBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                document.body.classList.remove('show-install-btn');
            }
            deferredPrompt = null;
        }
    });
}
