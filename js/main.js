/**
 * main.js — Entry Point Desktop
 * Responsabilidade: Gerenciar a interface desktop, janela Picture-in-Picture (PiP),
 * Drag & Drop, Hotkeys e a interação fluida com o AppCore compartilhado.
 */

import { AppCore } from './app-core.js';
import { CONFIG } from './config.js';
import { HotkeyManager } from './hotkeys.js';

// ========================================================
// 1. ESTADO DE JANELA & PiP (Desktop Only)
// ========================================================
let activeExternalWindow = null;
let activePipWindow = null;
let _pipSessionId = 0;
let lastMicPosition = { x: null, y: null };
let undoTimeout = null;

// ========================================================
// 2. REFERÊNCIAS DE UI (DOM Elements)
// ========================================================
const ui = {
    textarea: document.getElementById('transcriptionArea'),
    charCount: document.getElementById('charCount'),
    miniVisualizer: document.getElementById('miniVisualizer'),
    statusMsg: document.getElementById('statusMsg'),
    micBtn: document.getElementById('micBtn'),
    audioSource: document.getElementById('audioSource'),
    engineToggle: document.getElementById('engineToggle'),
    engineLabel: document.getElementById('engineLabel'),
    exportBtn: document.getElementById('exportBtn'),
    btnAiFix: document.getElementById('aiFixBtn'),
    btnAiLegal: document.getElementById('aiLegalBtn'),
    btnCopy: document.getElementById('copyBtn'),
    btnClear: document.getElementById('clearBtn'),
    toggleSizeBtn: document.getElementById('toggleSizeBtn'),
    container: document.getElementById('appContainer'),
    helpBtn: document.getElementById('helpBtn'),
    toastContainer: document.getElementById('toastContainer'),
    glossaryBtn: document.getElementById('glossaryBtn'),
    glossaryModal: document.getElementById('glossaryModal'),
    closeGlossaryBtn: document.getElementById('closeGlossaryBtn'),
    glossaryList: document.getElementById('glossaryList'),
    termInput: document.getElementById('termInput'),
    replaceInput: document.getElementById('replaceInput'),
    addTermBtn: document.getElementById('addTermBtn'),
    focusModeBtn: document.getElementById('focusModeBtn'),
    installPwaBtn: document.getElementById('installPwaBtn'),
    popOutBottomBtn: document.getElementById('popOutBottomBtn'),
    dragImage: document.getElementById('dragImage'),
    pipPlaceholder: document.getElementById('pipPlaceholder')
};

// ========================================================
// 3. WAKE LOCK (Modo Insônia)
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
// 4. INSTANCIAÇÃO DO NÚCLEO (APP CORE)
// ========================================================
const core = new AppCore(ui, {
    onRecordingStart: () => toggleWakeLock(true),
    onRecordingStop: () => toggleWakeLock(false),
    onTranscription: () => transitionToActionState(),
    onSuccess: (msg) => { /* Toasts nativos são usados apenas no mobile */ }
});

// ========================================================
// 5. PICTURE-IN-PICTURE E WIDGET MANAGEMENT
// ========================================================

function injectMoveScript(win, targetLeft, targetTop) {
    if (!win || win.closed) return;
    try {
        const x = targetLeft | 0, y = targetTop | 0;
        const script = win.document.createElement('script');
        script.textContent = `
            (function() {
                var x = ${x}, y = ${y}, max = 8, tol = 32, n = 0;
                var t = setInterval(function() {
                    window.moveTo(x, y);
                    n++;
                    if ((Math.abs(window.screenX - x) <= tol && Math.abs(window.screenY - y) <= tol) || n >= max) {
                        clearInterval(t);
                    }
                }, 150);
            })();
        `;
        win.document.head.appendChild(script);
    } catch (err) {
        _externalMoveTo(win, targetLeft, targetTop);
    }
}

function _externalMoveTo(win, targetLeft, targetTop) {
    let attempts = 0;
    const timer = setInterval(() => {
        if (!win || win.closed) { clearInterval(timer); return; }
        try { win.moveTo(targetLeft, targetTop); } catch (_) {}
        attempts++;
        let sx, sy;
        try { sx = win.screenX; sy = win.screenY; } catch (_) { sx = null; sy = null; }
        if ((sx !== null && Math.abs(sx - targetLeft) <= 32 && Math.abs(sy - targetTop) <= 32) || attempts >= 8) {
            clearInterval(timer);
        }
    }, 150);
}

function isInFloatingWindow() {
    const pipWin = (typeof documentPictureInPicture !== 'undefined') ? documentPictureInPicture?.window : null;
    if (pipWin && pipWin.document === ui.container.ownerDocument) return true;
    return !!activeExternalWindow;
}

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
                link.rel = 'stylesheet'; link.href = sheet.href;
                pipWin.document.head.appendChild(link);
            }
        }
    });
}

async function openPipWindow(width, height) {
    const pipWin = await documentPictureInPicture.requestWindow({ width, height, disallowReturnToOpener: false });
    activePipWindow = pipWin;
    const capturedSessionId = _pipSessionId;

    cloneStylesToPipWindow(pipWin);
    pipWin.document.body.classList.add('is-pip-mode');
    pipWin.document.body.appendChild(ui.container);

    ui.container.style.opacity = '';
    if (core.speechManager?.refreshVisualizer) {
        requestAnimationFrame(() => core.speechManager.refreshVisualizer());
    }

    pipWin.addEventListener('pagehide', () => {
        if (activePipWindow === pipWin) activePipWindow = null;
        if (_pipSessionId !== capturedSessionId) return;

        if (ui.pipPlaceholder) ui.pipPlaceholder.style.display = 'none';
        document.body.appendChild(ui.container);
        ui.container.classList.remove('minimalist-mode', 'minimized');
        ui.container.style.opacity = '';
        setUIMode(false);
    });

    return pipWin;
}

async function transitionToActionState() {
    if (!ui.container.classList.contains('minimalist-mode')) return;

    const currentWin = activeExternalWindow || activePipWindow;
    if (currentWin) {
        lastMicPosition.x = currentWin.screenX; lastMicPosition.y = currentWin.screenY;
    }

    ui.container.classList.remove('minimalist-mode');
    ui.container.classList.add('minimized');

    if (activeExternalWindow) {
        try {
            const { ACTION_W: W, ACTION_H: H } = CONFIG.UI.WINDOW;
            const cx = activeExternalWindow.screenX + (activeExternalWindow.outerWidth / 2);
            const cy = activeExternalWindow.screenY + (activeExternalWindow.outerHeight / 2);
            activeExternalWindow.resizeTo(W, H);
            activeExternalWindow.moveTo(cx - W / 2, cy - H / 2);
        } catch (e) {}
        return;
    }

    if (activePipWindow) {
        try {
            const { ACTION_W: W, ACTION_H: H } = CONFIG.UI.WINDOW;
            const prevX = activePipWindow.screenX, prevY = activePipWindow.screenY;
            ui.container.style.opacity = '0';
            _pipSessionId++;
            document.body.appendChild(ui.container);
            activePipWindow.close();
            await new Promise(r => setTimeout(r, 80));
            await openPipWindow(W, H);
            injectMoveScript(activePipWindow, prevX, prevY);
        } catch (e) {
            ui.container.style.opacity = '';
            if (ui.pipPlaceholder) ui.pipPlaceholder.style.display = 'none';
            document.body.appendChild(ui.container);
            ui.container.classList.remove('minimalist-mode', 'minimized');
            setUIMode(false);
        }
    }
}

async function transitionToMicState() {
    if (!isInFloatingWindow() || !ui.container.classList.contains('minimized')) return;

    ui.container.classList.remove('minimized');
    ui.container.classList.add('minimalist-mode');

    if (activeExternalWindow) {
        try {
            const { MIC_W: W, MIC_H: H } = CONFIG.UI.WINDOW;
            activeExternalWindow.resizeTo(W, H);
            if (lastMicPosition.x !== null && lastMicPosition.y !== null) {
                activeExternalWindow.moveTo(lastMicPosition.x, lastMicPosition.y);
            } else {
                const cx = activeExternalWindow.screenX + (activeExternalWindow.outerWidth / 2);
                const cy = activeExternalWindow.screenY + (activeExternalWindow.outerHeight / 2);
                activeExternalWindow.moveTo(cx - W / 2, cy - H / 2);
            }
        } catch (e) {}
        return;
    }

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
            injectMoveScript(activePipWindow, targetX, targetY);
        } catch (e) {}
    }
}

function setUIMode(isMinimized) {
    isMinimized ? ui.container.classList.add('minimized') : ui.container.classList.remove('minimized');
    
    const iconMinimize = ui.container.querySelector('#iconMinimize');
    const iconMaximize = ui.container.querySelector('#iconMaximize');
    if (iconMinimize) iconMinimize.classList.toggle('icon-hidden', isMinimized);
    if (iconMaximize) iconMaximize.classList.toggle('icon-hidden', !isMinimized);

    const isPip = !!window.documentPictureInPicture?.window;
    const isOwnPopup = (activeExternalWindow === window);
    
    if (window.outerWidth && !isPip && !isOwnPopup) {
        const targetWidth = isMinimized ? 360 : 1080; 
        const targetHeight = isMinimized ? 500 : 800; 
        try {
            const left = (window.screen.availLeft || 0) + window.screen.availWidth - targetWidth - 20;
            const top = (window.screen.availTop || 0) + window.screen.availHeight - targetHeight - 20;
            window.resizeTo(targetWidth, targetHeight);
            window.moveTo(left, top);
        } catch (e) {}
    }
    if (isMinimized) setTimeout(() => ui.textarea.scrollTop = ui.textarea.scrollHeight, 100);
}

// ========================================================
// 6. EVENT LISTENERS E DESKTOP UI
// ========================================================

const stopVisualEffects = () => {
    [ui.micBtn, ui.btnAiLegal, ui.btnAiFix, ui.btnCopy, ui.btnClear].forEach(btn => {
        if(btn) btn.classList.remove('pulsing');
    });
};

ui.micBtn.addEventListener('click', () => {
    ui.toastContainer.innerHTML = '';
    if (undoTimeout) clearTimeout(undoTimeout);
    stopVisualEffects();
    core.toggleRecording();
});

ui.btnAiFix.addEventListener('click', async () => {
    if (!ui.textarea.value.trim()) return alert("Digite ou dite algo primeiro.");
    stopVisualEffects();
    ui.btnAiFix.classList.add('pulsing');
    try { await core.fixGrammar(); } 
    catch (e) { alert("Erro na IA: " + e.message); } 
    finally { ui.btnAiFix.classList.remove('pulsing'); }
});

ui.btnAiLegal.addEventListener('click', async () => {
    if (!ui.textarea.value.trim()) return alert("Digite ou dite algo primeiro.");
    stopVisualEffects();
    ui.btnAiLegal.classList.add('pulsing'); 
    
    try { 
        await core.convertToLegal(); 
        
        // Feedback visual nativo
        const span = ui.btnAiLegal.querySelector('span');
        const original = span ? span.textContent : '';
        if (span) span.textContent = 'Aplicado!';
        ui.btnAiLegal.classList.add('copy-success');
        
        setTimeout(() => {
            if (span) span.textContent = original;
            ui.btnAiLegal.classList.remove('copy-success');
        }, 1500);

    } 
    catch (e) { alert("Erro ao preparar diretriz: " + e.message); } 
    finally { ui.btnAiLegal.classList.remove('pulsing'); }
});

ui.btnCopy.addEventListener('click', async () => {
    const text = ui.textarea.value.trim();
    if (!text) return;
    
    stopVisualEffects();
    ui.btnCopy.classList.add('pulsing');
    await core.copyToClipboard(text);
    
    const span = ui.btnCopy.querySelector('span');
    const originalText = span ? span.textContent : '';
    if (span) span.textContent = 'Copiado!';
    ui.btnCopy.classList.add('copy-success');
    
    setTimeout(() => {
        if (span) span.textContent = originalText;
        ui.btnCopy.classList.remove('copy-success', 'pulsing');
    }, 1500);
});

ui.exportBtn?.addEventListener('click', () => {
    if (!ui.textarea.value.trim()) return alert("Não há texto para exportar.");
    ui.exportBtn.classList.add('pulsing');
    core.exportTxt();
    setTimeout(() => ui.exportBtn.classList.remove('pulsing'), 1000);
});

ui.btnClear.addEventListener('click', () => {
    ui.toastContainer.innerHTML = '';
    if (undoTimeout) clearTimeout(undoTimeout);
    stopVisualEffects();
    
    if (core.speechManager?.isRecording) {
        core.toggleRecording();
    }
    
    if (!ui.textarea.value) return;
    const deleted = core.clearWithUndo();
    
    if (deleted) {
        if (!isInFloatingWindow()) showUndoToast();
        transitionToMicState();
    }
});

function showUndoToast() {
    ui.toastContainer.innerHTML = '';
    const isCompact = ui.container.classList.contains('minimized');
    ui.toastContainer.classList.toggle('compact-mode', isCompact);

    if (isCompact) {
        const btn = document.createElement('button');
        btn.className = 'btn-undo-float';
        btn.setAttribute('data-tooltip', 'Desfazer (Alt+Z)');
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 7"/></svg>`;
        btn.addEventListener('click', handleUndoRequest);
        ui.toastContainer.appendChild(btn);
    } else {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `<span>Texto limpo.</span><button id="undoBtn" class="btn-undo">Desfazer (Alt+Z)</button>`;
        ui.toastContainer.appendChild(toast);
        document.getElementById('undoBtn').addEventListener('click', handleUndoRequest);
    }

    undoTimeout = setTimeout(() => {
        const element = ui.toastContainer.firstElementChild;
        if (element) {
            element.style.opacity = '0';
            element.style.transform = isCompact ? 'scale(0)' : 'translateY(20px)';
            setTimeout(() => ui.toastContainer.innerHTML = '', 300);
        }
    }, 5000);
}

function handleUndoRequest() {
    core.performUndo();
    ui.toastContainer.innerHTML = '';
    if (undoTimeout) clearTimeout(undoTimeout);
}

ui.toggleSizeBtn?.addEventListener('click', () => {
    const pipWindow = window.documentPictureInPicture?.window;
    if (pipWindow && ui.toggleSizeBtn.ownerDocument === pipWindow.document) {
        pipWindow.close(); return;
    }
    setUIMode(!ui.container.classList.contains('minimized'));
});

ui.focusModeBtn?.addEventListener('click', () => {
    ui.container.classList.toggle('focus-mode');
    ui.textarea.scrollTop = ui.textarea.scrollHeight;
});

// ========================================================
// 7. DRAG & DROP E DISPOSITIVOS (Desktop Only)
// ========================================================

const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
if (supportsHover && ui.btnCopy) {
    ui.btnCopy.setAttribute('draggable', 'true');
    ui.btnCopy.addEventListener('dragstart', (e) => {
        const textToDrag = ui.textarea.value.trim();
        if (!textToDrag) { e.preventDefault(); return; }
        e.dataTransfer.setData('text/plain', textToDrag);
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setDragImage(ui.dragImage, 0, 0);
    });
}

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
        if (savedId) core.speechManager.setDeviceId(savedId);
    };

    const devices = await core.speechManager.getAudioDevices();
    populate(devices);
    core.speechManager.listenToDeviceChanges((updatedDevices) => populate(updatedDevices));

    ui.audioSource.addEventListener('change', (e) => {
        const val = e.target.value;
        core.speechManager.setDeviceId(val);
        localStorage.setItem(CONFIG.STORAGE_KEYS.MIC, val);
    });
}

// ========================================================
// 8. GLOSSÁRIO
// ========================================================

function renderGlossary() {
    if (!ui.glossaryList) return;
    ui.glossaryList.innerHTML = '';
    const terms = core.glossary.getTerms();
    
    if (terms.length === 0) {
        ui.glossaryList.innerHTML = '<p style="color:#9ca3af; text-align:center;">Nenhum termo cadastrado.</p>';
        return;
    }

    terms.forEach((term, index) => {
        const div = document.createElement('div');
        div.className = 'glossary-item';
        div.innerHTML = `
            <span class="term-pair"><span class="term-from">${term.from}</span> <span class="term-arrow">➜</span> <span class="term-to">${term.to}</span></span>
            <button class="btn-delete-term" data-index="${index}">&times;</button>
        `;
        ui.glossaryList.appendChild(div);
    });

    document.querySelectorAll('.btn-delete-term').forEach(btn => {
        btn.addEventListener('click', (e) => {
            core.glossary.remove(parseInt(e.target.dataset.index));
            renderGlossary();
        });
    });
}

if (ui.glossaryBtn && ui.glossaryModal) {
    ui.glossaryBtn.addEventListener('click', () => { renderGlossary(); ui.glossaryModal.style.display = 'flex'; });
    ui.closeGlossaryBtn.addEventListener('click', () => ui.glossaryModal.style.display = 'none');
    ui.addTermBtn.addEventListener('click', () => {
        core.glossary.add(ui.termInput.value, ui.replaceInput.value);
        ui.termInput.value = ''; ui.replaceInput.value = '';
        renderGlossary();
    });
}

// ========================================================
// 9. STARTUP E EVENTOS GLOBAIS
// ========================================================

window.addEventListener('DOMContentLoaded', () => {
    core.loadContent();
    initDeviceSelector();

    if (ui.engineToggle) {
        const isWhisper = localStorage.getItem(CONFIG.STORAGE_KEYS.ENGINE) === 'whisper';
        ui.engineToggle.checked = isWhisper;
        if (ui.engineLabel) ui.engineLabel.textContent = isWhisper ? 'Whisper AI' : 'Nativo';
        
        ui.engineToggle.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            core.setEngine(isChecked);
            if (ui.engineLabel) ui.engineLabel.textContent = isChecked ? 'Whisper AI' : 'Nativo';
        });
    }

    new HotkeyManager(ui, {
        triggerClear: () => ui.btnClear.click(),
        triggerUndo: handleUndoRequest
    });

    const _isMobile = window.matchMedia('(max-width: 768px)').matches;
    const _isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const _isPopup = !!window.opener;
    const _canUsePiP = 'documentPictureInPicture' in window;

    if (!_isMobile && !_isStandalone && !_isPopup) {
        document.body.classList.add('is-desktop-tab');
    }

    const setupCompactModeLaunch = (btnElement, positionTarget) => {
        if (!btnElement) return;
        const calcTargetPosition = () => {
            const { MIC_W: W, MIC_H: H } = CONFIG.UI.WINDOW;
            const screenLeft = window.screen.availLeft ?? 0, screenTop = window.screen.availTop ?? 0;
            return {
                W, H,
                targetLeft: (screenLeft + window.screen.availWidth) - W - 16,
                targetTop: positionTarget === 'top' ? screenTop + 16 : (screenTop + window.screen.availHeight) - H - 16
            };
        };

        btnElement.addEventListener('click', async () => {
            const { W, H, targetLeft, targetTop } = calcTargetPosition();
            lastMicPosition = { x: targetLeft, y: targetTop };

            if (_canUsePiP) {
                try {
                    ui.container.classList.remove('minimized');
                    ui.container.classList.add('minimalist-mode');
                    if (ui.pipPlaceholder) ui.pipPlaceholder.style.display = 'flex';
                    await openPipWindow(W, H);
                    injectMoveScript(activePipWindow, targetLeft, targetTop);
                } catch (err) {
                    ui.container.classList.remove('minimalist-mode');
                    if (ui.pipPlaceholder) ui.pipPlaceholder.style.display = 'none';
                    ui.statusMsg.textContent = 'Permissão de janela negada.';
                    ui.statusMsg.className = 'status-bar active status-warning';
                    setTimeout(() => ui.statusMsg.className = 'status-bar', 4000);
                }
            } else {
                window.open(window.location.pathname + '?mode=compact-mic', 'DitadoWidget',
                    `width=${W},height=${H},left=${targetLeft},top=${targetTop},popup=yes,resizable=yes,scrollbars=no,toolbar=no,menubar=no,status=no`
                );
            }
        });
    };

    setupCompactModeLaunch(ui.popOutBottomBtn, 'bottom');

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'compact') {
        setTimeout(() => { if (!ui.container.classList.contains('minimized')) ui.toggleSizeBtn.click(); }, 100);
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

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.body.classList.add('show-install-btn');
});

ui.installPwaBtn?.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') document.body.classList.remove('show-install-btn');
        deferredPrompt = null;
    }
});
