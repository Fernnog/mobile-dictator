import { SpeechManager } from './speech-manager.js';
import { aiService } from './llm-service.js';
import Glossary from './glossary.js';
import { CONFIG } from './config.js';

// ========================================================
// 1. REFERÊNCIAS DE UI (DOM Elements)
// ========================================================
const ui = {
    textarea: document.getElementById('transcriptionArea'),
    charCount: document.getElementById('charCount'),
    statusMsg: document.getElementById('statusMsg'),
    micBtn: document.getElementById('micBtn'),
    btnAiFix: document.getElementById('aiFixBtn'),
    btnCopy: document.getElementById('copyBtn'),
    canvas: document.getElementById('audioVisualizer')
};

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
            console.warn('Wake Lock não disponível no mobile:', err);
        }
    }
};

document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        try { wakeLock = await navigator.wakeLock.request('screen'); } catch(e){}
    }
});

// ========================================================
// 3. MÓDULOS DE SERVIÇO
// ========================================================

// Instancia o glossário sem callback de UI (ele atuará de forma invisível/backend)
const glossaryManager = new Glossary();

// ========================================================
// 4. CALLBACKS E CONTROLES
// ========================================================

const stopVisualEffects = () => {
    ui.micBtn.classList.remove('pulsing');
    ui.btnAiFix.classList.remove('pulsing');
    ui.btnCopy.classList.remove('pulsing');
};

const updateStatus = (status) => {
    ui.statusMsg.className = 'status-bar';
    ui.micBtn.style.backgroundColor = ''; 
    stopVisualEffects();

    if (status === 'starting') {
        ui.statusMsg.textContent = "CONECTANDO...";
        ui.statusMsg.classList.add('active', 'status-starting');
        ui.micBtn.style.backgroundColor = '#eab308'; // Amber
        ui.micBtn.classList.add('pulsing');
    } else if (status === 'recording') {
        ui.statusMsg.textContent = "GRAVANDO";
        ui.statusMsg.classList.add('active', 'status-recording');
        ui.micBtn.classList.add('recording', 'pulsing');
        ui.canvas.style.display = 'block'; // Mostra visualizador
    } else if (status === 'processing') {
        ui.statusMsg.textContent = "PROCESSANDO IA...";
        ui.statusMsg.classList.add('active', 'status-ai');
    } else if (status === 'error') {
        ui.statusMsg.textContent = "ERRO / BLOQUEADO";
        ui.statusMsg.classList.add('active', 'status-error');
        ui.micBtn.classList.remove('recording');
        toggleWakeLock(false);
    } else {
        ui.statusMsg.textContent = "";
        ui.statusMsg.classList.remove('active');
        ui.micBtn.classList.remove('recording'); 
    }
};

const handleTranscriptionResult = (finalText, interimText) => {
    if (finalText) {
        // Aplica substituições do Glossário localmente
        const processedText = glossaryManager.process(finalText);
        
        const text = ui.textarea.value;
        const prefix = (text.length > 0 && !text.endsWith(' ') && !text.endsWith('\n')) ? ' ' : '';
        
        ui.textarea.value = text + prefix + processedText;
        
        updateCharCount();
        saveContent();
        
        // Auto-scroll para o usuário ler o que está ditando
        requestAnimationFrame(() => {
            ui.textarea.scrollTop = ui.textarea.scrollHeight;
        });
    }
};

// Instancia o Engine de Áudio
const speechManager = new SpeechManager('audioVisualizer', handleTranscriptionResult, updateStatus);
// Lê a preferência de motor (Nativo vs Whisper) do storage
speechManager.useWhisper = localStorage.getItem('dd_engine_pref') === 'whisper';

// ========================================================
// 5. EVENT LISTENERS
// ========================================================

ui.micBtn.addEventListener('click', () => {
    // Feedback Tátil (Haptics) Nativo do Android
    if (navigator.vibrate) navigator.vibrate(50);

    if (speechManager.isRecording) {
        speechManager.stop();
        toggleWakeLock(false);
    } else {
        updateStatus('starting'); 
        speechManager.start();
        toggleWakeLock(true);
    }
});

ui.btnCopy.addEventListener('click', async () => {
    const text = ui.textarea.value.trim();
    if (!text) return;
    
    if (navigator.vibrate) navigator.vibrate(30);

    try {
        await navigator.clipboard.writeText(text);
        
        // Feedback Visual
        ui.btnCopy.classList.add('copy-success', 'pulsing');
        
        // Tenta usar a API nativa de Compartilhamento do Android (Web Share API)
        if (navigator.share) {
            await navigator.share({
                title: 'Texto Ditado',
                text: text
            });
        }
    } catch (e) {
        console.warn('Erro ao copiar ou compartilhar:', e);
    } finally {
        setTimeout(() => ui.btnCopy.classList.remove('copy-success', 'pulsing'), 1500);
    }
});

ui.btnAiFix.addEventListener('click', async () => {
    const text = ui.textarea.value.trim();
    if (!text) return alert("Digite ou dite algo primeiro.");

    if (navigator.vibrate) navigator.vibrate([30, 50, 30]); // Padrão de vibração

    // Pausa a gravação por segurança caso esteja ativa
    if (speechManager.isRecording) {
        speechManager.stop();
        toggleWakeLock(false);
    }

    ui.btnAiFix.classList.add('pulsing');
    updateStatus('processing');
    
    try {
        const result = await aiService.fixGrammar(text);
        ui.textarea.value = result;
        saveContent();
        updateStatus('');
    } catch (error) {
        alert("Erro na IA: " + error.message);
        updateStatus('error');
        setTimeout(() => updateStatus(''), 2000);
    } finally {
        ui.btnAiFix.classList.remove('pulsing');
    }
});

// ========================================================
// 6. INICIALIZAÇÃO
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

window.addEventListener('DOMContentLoaded', () => {
    loadContent();
    // Garante que o visualizador fique oculto até que a gravação comece
    if (ui.canvas) {
        ui.canvas.style.display = 'block'; 
        ui.canvas.classList.remove('audio-detected');
    }
});
