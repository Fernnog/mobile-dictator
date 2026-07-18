/**
 * app-core.js — Núcleo de Negócio Compartilhado
 * Responsabilidade: Estado, gravação, IA, clipboard, exportação, undo.
 * NÃO contém lógica de plataforma (PiP, hotkeys, drag-drop, haptics).
 */

import { SpeechManager } from './speech-manager.js';
import { aiService, EXTERNAL_LEGAL_PROMPT } from './llm-service.js';
import Glossary from './glossary.js';
import { CONFIG } from './config.js';

export class AppCore {
    constructor(uiRefs, platformHooks = {}) {
        this.ui = uiRefs;
        this.hooks = platformHooks; // { onRecordingStart, onRecordingStop, onError, onSuccess }
        
        this.glossary = new Glossary();
        this.undoTimeout = null;
        this.tempDeletedText = '';
        
        this.speechManager = new SpeechManager(
            this.resolveCanvasId(),
            this.handleTranscription.bind(this),
            this.handleStatus.bind(this)
        );
        
        // Restaura preferência de motor
        this.speechManager.useWhisper = localStorage.getItem(CONFIG.STORAGE_KEYS.ENGINE) === 'whisper';
    }

    resolveCanvasId() {
        // Canvas pode ter IDs diferentes entre mobile e desktop
        return this.ui.canvas?.id || 'audioVisualizer';
    }

    /* ---------- ESTADO & PERSISTÊNCIA ---------- */
    
    loadContent() {
        const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.TEXT);
        if (saved && this.ui.textarea) {
            this.ui.textarea.value = saved;
            this.updateCharCount();
        }
    }

    saveContent() {
        localStorage.setItem(CONFIG.STORAGE_KEYS.TEXT, this.ui.textarea.value);
    }

    updateCharCount() {
        if (this.ui.charCount) {
            this.ui.charCount.textContent = `${this.ui.textarea.value.length} caracteres`;
        }
    }

    /* ---------- CALLBACKS DO SPEECH MANAGER ---------- */

    handleTranscription(finalText, interimText) {
        if (!finalText) return;
        
        const processed = this.glossary.process(finalText);
        const text = this.ui.textarea.value;
        const start = this.ui.textarea.selectionStart || 0;
        const end = this.ui.textarea.selectionEnd || 0;
        const before = text.substring(0, start);
        const after = text.substring(end);
        const prefix = (before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n')) ? ' ' : '';
        
        this.ui.textarea.value = before + prefix + processed + after;
        this.ui.textarea.setSelectionRange(
            start + prefix.length + processed.length,
            start + prefix.length + processed.length
        );
        
        this.saveContent();
        this.updateCharCount();
        
        // Scroll automático
        requestAnimationFrame(() => {
            this.ui.textarea.scrollTop = this.ui.textarea.scrollHeight;
        });

        // Hook para expansão de tela (usado por android.js)
        if (this.hooks.onTranscription) this.hooks.onTranscription();
    }

    handleStatus(status) {
        const el = this.ui.statusMsg;
        if (!el) return;
        
        el.className = 'status-bar';
        if (this.ui.micBtn) this.ui.micBtn.style.backgroundColor = '';

        const map = {
            starting:  { text: 'CONECTANDO...', cls: 'status-starting', color: '#eab308', pulse: true },
            recording: { text: 'GRAVANDO',      cls: 'status-recording', pulse: true, recording: true },
            processing:{ text: 'PROCESSANDO IA...', cls: 'status-ai' },
            error:     { text: 'ERRO / BLOQUEADO',  cls: 'status-error' },
            idle:      { text: '', cls: '' }
        };

        const cfg = map[status] || map.idle;
        if (cfg.text) {
            el.textContent = cfg.text;
            el.classList.add('active', cfg.cls);
        }
        if (cfg.color && this.ui.micBtn) this.ui.micBtn.style.backgroundColor = cfg.color;
        if (cfg.pulse && this.ui.micBtn) this.ui.micBtn.classList.add('pulsing');
        if (cfg.recording && this.ui.micBtn) this.ui.micBtn.classList.add('recording');
        
        if (status === 'error' || status === 'idle') {
            if (this.ui.micBtn) this.ui.micBtn.classList.remove('recording', 'pulsing');
        }
    }

    /* ---------- AÇÕES DO USUÁRIO ---------- */

    async toggleRecording() {
        if (this.speechManager.isRecording) {
            this.speechManager.stop();
            if (this.hooks.onRecordingStop) this.hooks.onRecordingStop();
        } else {
            this.handleStatus('starting');
            this.speechManager.start();
            if (this.hooks.onRecordingStart) this.hooks.onRecordingStart();
        }
    }

    async fixGrammar() {
        const text = this.ui.textarea.value.trim();
        if (!text) throw new Error('EMPTY_TEXT');

        this.handleStatus('processing');
        try {
            const result = await aiService.fixGrammar(text);
            this.ui.textarea.value = result;
            this.saveContent();
            this.updateCharCount();
            this.handleStatus('idle');
            if (this.hooks.onSuccess) this.hooks.onSuccess('Gramática corrigida');
        } catch (err) {
            this.handleStatus('error');
            throw err;
        }
    }

    async convertToLegal() {
        const text = this.ui.textarea.value.trim();
        if (!text) throw new Error('EMPTY_TEXT');

        this.handleStatus('processing');
        try {
            const result = await aiService.convertToLegal(text);
            this.ui.textarea.value = result;
            this.saveContent();
            this.updateCharCount();
            
            const payload = `${EXTERNAL_LEGAL_PROMPT}\n\n[MINHAS DIRETRIZES E CONTEXTO]\n\n${result}`;
            await this.copyToClipboard(payload);
            this.handleStatus('idle');
            if (this.hooks.onSuccess) this.hooks.onSuccess('Diretriz copiada');
        } catch (err) {
            this.handleStatus('error');
            throw err;
        }
    }

    async copyToClipboard(text) {
        const win = this.ui.textarea.ownerDocument.defaultView;
        try {
            await win.navigator.clipboard.writeText(text);
        } catch {
            const doc = this.ui.textarea.ownerDocument;
            const ta = doc.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;inset:0;opacity:0;pointer-events:none;';
            doc.body.appendChild(ta);
            ta.focus(); ta.select();
            doc.execCommand('copy');
            doc.body.removeChild(ta);
        }
    }

    exportTxt() {
        const text = this.ui.textarea.value.trim();
        if (!text) throw new Error('EMPTY_TEXT');

        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Ditado_${new Date().toISOString().slice(0,10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    clearWithUndo() {
        if (!this.ui.textarea.value) return;
        this.tempDeletedText = this.ui.textarea.value;
        this.ui.textarea.value = '';
        this.saveContent();
        this.updateCharCount();
        return this.tempDeletedText; // Retorna para a UI montar o toast
    }

    performUndo() {
        if (this.tempDeletedText) {
            this.ui.textarea.value = this.tempDeletedText;
            this.saveContent();
            this.updateCharCount();
            this.tempDeletedText = '';
            this.ui.textarea.scrollTop = this.ui.textarea.scrollHeight;
        }
    }

    setEngine(useWhisper) {
        this.speechManager.useWhisper = useWhisper;
        localStorage.setItem(CONFIG.STORAGE_KEYS.ENGINE, useWhisper ? 'whisper' : 'native');
    }
}
