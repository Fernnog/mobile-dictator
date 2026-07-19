/**
 * android.js — Thin Controller Mobile
 * Responsabilidade: Inicializar AppCore, anexar listeners touch,
 * gerenciar Wake Lock, Haptics e Web Share.
 */

import { AppCore } from './app-core.js';

const ui = {
    textarea:     document.getElementById('transcriptionArea'),
    charCount:    document.getElementById('charCount'),
    statusMsg:    document.getElementById('statusMsg'),
    micBtn:       document.getElementById('micBtn'),
    btnAiFix:     document.getElementById('aiFixBtn'),
    btnAiLegal:   document.getElementById('aiLegalBtn'),
    btnCopy:      document.getElementById('copyBtn'),
    btnClear:     document.getElementById('clearBtn'),
    btnExport:    document.getElementById('exportBtn'),
    engineToggle: document.getElementById('engineToggle'),
    engineLabel:  document.getElementById('engineLabel'),
    toastContainer: document.getElementById('toastContainer')
};

/* ---------- WAKE LOCK ---------- */
let wakeLock = null;
const setWakeLock = async (lock) => {
    if (!('wakeLock' in navigator)) return;
    try {
        if (lock && !wakeLock) wakeLock = await navigator.wakeLock.request('screen');
        else if (!lock && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { console.warn('Wake Lock indisponível:', e); }
};

document.addEventListener('visibilitychange', async () => {
    if (wakeLock && document.visibilityState === 'visible') {
        try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
    }
});

/* ---------- HAPTICS ---------- */
const haptic = (pattern) => {
    if (navigator.vibrate) navigator.vibrate(pattern);
};

/* ---------- TOAST MOBILE ---------- */
const showToast = (msg, actionText, actionFn) => {
    const c = ui.toastContainer;
    c.innerHTML = '';
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>${msg}</span>`;
    if (actionText && actionFn) {
        const btn = document.createElement('button');
        btn.className = 'btn-undo';
        btn.textContent = actionText;
        btn.onclick = () => { actionFn(); c.innerHTML = ''; };
        toast.appendChild(btn);
    }
    c.appendChild(toast);
    setTimeout(() => { if (c.contains(toast)) c.removeChild(toast); }, 5000);
};

/* ---------- INICIALIZAÇÃO ---------- */
const core = new AppCore(ui, {
    onRecordingStart: () => setWakeLock(true),
    onRecordingStop:  () => setWakeLock(false),
    onTranscription:  () => {
        // Expande automaticamente do modo mic minimalista para modo ação
        document.body.classList.remove('minimalist-mode');
        document.body.classList.add('has-content');
    },
    onSuccess: (msg) => showToast(msg)
});

// Carrega conteúdo salvo
core.loadContent();

// Ativa modo foco automaticamente se houver texto
if (ui.textarea.value.length > 0) {
    document.body.classList.add('focus-mode', 'has-content');
}

/* ---------- EVENT LISTENERS ---------- */

ui.micBtn.addEventListener('click', () => {
    haptic(50);
    core.toggleRecording();
});

ui.btnAiFix.addEventListener('click', async () => {
    haptic([30, 50, 30]);
    try { await core.fixGrammar(); } 
    catch (e) { showToast(e.message === 'EMPTY_TEXT' ? 'Dite algo primeiro' : 'Erro na IA'); }
});

ui.btnAiLegal.addEventListener('click', async () => {
    haptic([30, 50, 30]);
    try { await core.convertToLegal(); }
    catch (e) { showToast(e.message === 'EMPTY_TEXT' ? 'Dite algo primeiro' : 'Erro na IA'); }
});

ui.btnCopy.addEventListener('click', async () => {
    haptic(30);
    const text = ui.textarea.value.trim();
    if (!text) return;
    await core.copyToClipboard(text);
    
    // Web Share API nativa do Android
    if (navigator.share) {
        try { await navigator.share({ title: 'Texto Ditado', text }); } catch {}
    }
    showToast('Copiado!');
});

ui.btnExport.addEventListener('click', () => {
    haptic(30);
    try { core.exportTxt(); showToast('Arquivo salvo!'); }
    catch (e) { showToast('Nada para exportar'); }
});

ui.btnClear.addEventListener('click', () => {
    haptic(40);
    const hadContent = core.clearWithUndo();
    if (hadContent) {
        showToast('Texto limpo', 'Desfazer', () => core.performUndo());
        // Retorna ao modo minimalista (apenas microfone visível)
        document.body.classList.remove('has-content', 'focus-mode');
    }
});

// Toggle de motor Whisper
if (ui.engineToggle) {
    const saved = localStorage.getItem('dd_engine_pref') || 'native';
    ui.engineToggle.checked = saved === 'whisper';
    if (ui.engineLabel) ui.engineLabel.textContent = saved === 'whisper' ? 'Whisper AI' : 'Nativo';
    
    ui.engineToggle.addEventListener('change', (e) => {
        const isWhisper = e.target.checked;
        core.setEngine(isWhisper);
        if (ui.engineLabel) ui.engineLabel.textContent = isWhisper ? 'Whisper AI' : 'Nativo';
    });
}

/* ---------- INSTALAÇÃO PWA (MOBILE) ---------- */
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    // Previne o mini-infobar padrão do Chrome para controle customizado
    e.preventDefault();
    deferredPrompt = e;

    // Evita duplicar o toast se o evento disparar múltiplas vezes
    if (document.getElementById('pwa-install-toast')) return;

    const toast = document.createElement('div');
    toast.id = 'pwa-install-toast';
    toast.className = 'toast';
    toast.innerHTML = `
        <span>Instalar Ditado Pro na tela inicial?</span>
        <button class="btn-undo" id="pwaInstallAction">Instalar</button>
    `;

    ui.toastContainer.appendChild(toast);

    document.getElementById('pwaInstallAction').addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            toast.remove();
            if (ui.statusMsg) showToast('App instalado com sucesso!');
        }
        deferredPrompt = null;
    });
});

// Se o app já estiver rodando como standalone (instalado), remove qualquer resíduo
if (window.matchMedia('(display-mode: standalone)').matches) {
    document.getElementById('pwa-install-toast')?.remove();
}
