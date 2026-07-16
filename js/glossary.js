import { CONFIG } from './config.js';

/**
 * Módulo Glossary (v1.0.3)
 * Responsável por gerenciar termos de substituição automática e persistência.
 * Desacoplado da UI, comunicando-se apenas via callback de renderização.
 */
export default class Glossary {
    /**
     * @param {Function} renderCallback - Função opcional chamada quando os dados mudam.
     */
    constructor(renderCallback) {
        this.renderCallback = renderCallback;
        this.terms = this.load();
    }

    /**
     * Carrega os termos do LocalStorage.
     * @returns {Array} Lista de termos.
     */
    load() {
        try {
            const data = localStorage.getItem(CONFIG.STORAGE_KEYS.GLOSSARY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error("Ditado Digital: Erro ao carregar glossário.", e);
            return [];
        }
    }

    /**
     * Salva o estado atual no LocalStorage.
     */
    save() {
        try {
            localStorage.setItem(CONFIG.STORAGE_KEYS.GLOSSARY, JSON.stringify(this.terms));
        } catch (e) {
            console.error("Ditado Digital: Erro ao salvar glossário.", e);
        }
    }

    /**
     * Adiciona um novo par de termos.
     * @param {string} from - O termo falado/digitado.
     * @param {string} to - O termo para substituição.
     */
    add(from, to) {
        if (!from || !to) return;
        
        // Armazenamos 'from' em lowercase para facilitar o match case-insensitive,
        // e aplicamos trim() para limpar espaços acidentais.
        this.terms.push({ 
            from: from.toLowerCase().trim(), 
            to: to.trim() 
        });
        
        this.save();
        this.triggerRender();
    }

    /**
     * Remove um termo pelo índice.
     * @param {number} index - Índice do termo no array.
     */
    remove(index) {
        if (index >= 0 && index < this.terms.length) {
            this.terms.splice(index, 1);
            this.save();
            this.triggerRender();
        }
    }

    /**
     * Processa o texto aplicando todas as substituições configuradas.
     * @param {string} text - O texto original transcrito.
     * @returns {string} O texto processado.
     */
    process(text) {
        if (!text) return text;
        
        let processed = text;
        
        this.terms.forEach(term => {
            // Cria uma Regex dinâmica para buscar a palavra inteira (\b).
            // 'g' = global (todas as ocorrências)
            // 'i' = case insensitive (ignora maiúsculas/minúsculas na busca)
            try {
                const regex = new RegExp(`\\b${term.from}\\b`, 'gi');
                processed = processed.replace(regex, term.to);
            } catch (e) {
                console.warn(`Termo inválido no glossário ignorado: ${term.from}`);
            }
        });

        return processed;
    }

    /**
     * Executa o callback de renderização se estiver definido.
     */
    triggerRender() {
        if (typeof this.renderCallback === 'function') {
            this.renderCallback(this.terms);
        }
    }

    /**
     * Retorna a lista atual de termos (útil para inicialização de UI).
     * @returns {Array}
     */
    getTerms() {
        return this.terms;
    }
}
