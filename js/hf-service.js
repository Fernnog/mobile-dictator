import { CONFIG } from './config.js';

class WhisperService {
    constructor() {
        // Mudamos o motor para a Groq: muito mais rápido, suporta CORS nativamente e usa Whisper V3
        this.modelUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';
        this.storageKey = 'dd_groq_token'; 
    }

    getToken() {
        let token = localStorage.getItem(this.storageKey);
        if (!token) {
            token = prompt("🚀 Atualização de Motor (Groq):\n\nPara resolver os bloqueios de rede, migramos para a Groq.\n\nInsira sua API Key da Groq (Inicia com 'gsk_'):\n(Obtenha sua chave gratuitamente em: console.groq.com/keys)");
            
            if (token && token.startsWith('gsk_')) {
                localStorage.setItem(this.storageKey, token);
            } else {
                alert("Token inválido. Ação cancelada.");
                return null;
            }
        }
        return token;
    }

    async transcribe(audioBlob) {
        const token = this.getToken();
        if (!token) throw new Error("Token ausente");

        // A API da Groq (compatível com padrão OpenAI) exige que o áudio seja enviado como um formulário (FormData)
        const formData = new FormData();
        // O backend precisa de um nome de arquivo virtual com extensão para identificar o formato
        formData.append("file", audioBlob, "audio.webm"); 
        formData.append("model", "whisper-large-v3"); // Modelo top de linha atual
        formData.append("language", "pt"); // Força o idioma para aumentar a precisão do reconhecimento

        try {
            // Chamada direta e limpa, sem proxies!
            const response = await fetch(this.modelUrl, {
                method: "POST",
                headers: { 
                    "Authorization": `Bearer ${token}`
                    // IMPORTANTE: Não definimos o Content-Type aqui. 
                    // O navegador faz isso automaticamente e injeta o "boundary" correto do FormData.
                },
                body: formData,
            });

            // Tratamento de erros de autenticação ou limites da API
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                // Se a chave for inválida (401), apagamos do storage para o sistema pedir de novo
                if (response.status === 401) {
                    localStorage.removeItem(this.storageKey);
                }
                throw new Error(errData.error?.message || `Erro do Servidor Groq: ${response.status}`);
            }

            const result = await response.json();
            
            if (!result.text) throw new Error("A API processou, mas não retornou texto.");
            return result.text;

        } catch (error) {
            console.error("Whisper API Error:", error);
            throw new Error(`Falha no reconhecimento: ${error.message}`);
        }
    }
}

// Mantemos o nome da exportação idêntico ao antigo. 
// Assim, o speech-manager.js nem percebe que trocamos o motor por baixo dos panos!
export const hfService = new WhisperService();
