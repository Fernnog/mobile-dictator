export const CONFIG = {
    STORAGE_KEYS: {
        TEXT: 'ditado_backup_text',
        MIC: 'ditado_pref_mic',
        GLOSSARY: 'dd_glossary',
        HF_TOKEN: 'dd_hf_token',
        ENGINE: 'dd_engine_pref'
    },
    AUDIO: {
        HIGHPASS_FREQ: 85,
        COMPRESSOR_THRESHOLD: -50,
        // [v1.0.7-patch] Configurações de Hardware (Relaxadas para evitar erros)
        CONSTRAINTS: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            // Usamos 'ideal' em vez de valor bruto. 
            // Se o hardware não suportar 48kHz ou Mono, o navegador negociará 
            // o melhor valor disponível em vez de lançar OverconstrainedError.
            channelCount: { ideal: 1 },        
            sampleRate: { ideal: 48000 }       
        }
    },
    SHORTCUTS: {
        REC: 'KeyG',
        CLEAR: 'KeyL',
        COPY: 'KeyC',
        UNDO: 'KeyZ',
        TOGGLE_MODE: 'KeyM'
    },
    UI: {
        TOAST_DURATION: 5000,
        WINDOW: {
            MIC_W: 100,
            MIC_H: 100,
            ACTION_W: 380,
            ACTION_H: 450,
            PIP_W: 380,
            PIP_H: 450
        }
    },
    LLM: {
        // Modelo de Raciocínio (Reasoning) da família Qwen na Groq
        MODEL_ID: "qwen/qwen3.6-27b", 
        
        // Parâmetros de infraestrutura ajustados conforme documentação oficial Groq
        MAX_COMPLETION_TOKENS: 4096, // Mantido em 4096 para proteção contra Rate Limit
        TEMPERATURE: 0.6,            // Tolerância a variação ajustada para 0.6
        TOP_P: 0.95,                 // Top-P exigido pelo endpoint
        REASONING_EFFORT: "default"  // Chave obrigatória para o modelo 3.6-27b
    }
};
