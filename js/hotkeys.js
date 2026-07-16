import { CONFIG } from './config.js';

export class HotkeyManager {
    constructor(uiRefs, actions) {
        this.ui = uiRefs;
        this.actions = actions; // Objeto com funções { rec, clear, copy, undo }
        this.init();
    }

    init() {
        document.addEventListener('keydown', (e) => {
            // Apenas processa se Alt estiver pressionado
            if (!e.altKey) return;

            // Mapeamento baseado em e.code (físico)
            switch (e.code) {
                case CONFIG.SHORTCUTS.REC:
                    e.preventDefault(); 
                    this.ui.micBtn.click();
                    break;
                
                case CONFIG.SHORTCUTS.CLEAR:
                    e.preventDefault();
                    this.actions.triggerClear(); 
                    break;
                
                case CONFIG.SHORTCUTS.COPY:
                    e.preventDefault();
                    this.ui.btnCopy.click();
                    break;
                
                case CONFIG.SHORTCUTS.UNDO:
                    e.preventDefault();
                    this.actions.triggerUndo();
                    break;

                // [NOVO v1.0.6] Alternar Modo Widget/Janela
                case CONFIG.SHORTCUTS.TOGGLE_MODE:
                    e.preventDefault();
                    // Simula o clique físico para aproveitar a lógica de redimensionamento do main.js
                    if (this.ui.toggleSizeBtn) {
                        this.ui.toggleSizeBtn.click();
                    }
                    break;
            }
        });
    }
}
