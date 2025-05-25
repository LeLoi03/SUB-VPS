// vps-gemini-worker/src/services/gemini/vpsClientManager.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { GoogleGenerativeAI, type GenerativeModel, type Content, type GenerationConfig as SDKGenerationConfig } from "@google/generative-ai";
import { VpsConfigService } from '../config/vpsConfig.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';

@singleton()
export class VpsGeminiClientManagerService {
    private readonly baseLogger: Logger;
    private readonly genAIInstances: Map<string, GoogleGenerativeAI> = new Map(); // key_0, key_1
    private readonly vpsApiKeys: string[];

    constructor(
        @inject(VpsConfigService) private configService: VpsConfigService,
        @inject(LoggingService) loggingService: LoggingService,
    ) {
        this.baseLogger = loggingService.getLogger('vps', { service: 'VpsGeminiClientManagerService' });
        this.vpsApiKeys = this.configService.config.VPS_GEMINI_API_KEYS;
        this.initializeAllClients();
    }

    private initializeAllClients(): void {
        if (this.vpsApiKeys.length === 0) {
            this.baseLogger.error({ event: 'vps_client_init_no_keys' }, "VPS: No Gemini API keys configured. Cannot initialize clients.");
            return;
        }

        this.vpsApiKeys.forEach((apiKey, index) => {
            const keyId = `key_${index}`;
            try {
                const genAI = new GoogleGenerativeAI(apiKey);
                this.genAIInstances.set(keyId, genAI);
                this.baseLogger.info({ event: 'vps_client_init_success', keyId }, `VPS: GoogleGenerativeAI client for ${keyId} initialized.`);
            } catch (error: any) {
                this.baseLogger.error({ event: 'vps_client_init_failed', keyId, err: error.message }, `VPS: Failed to initialize client for ${keyId}.`);
            }
        });
         if (this.genAIInstances.size === 0) {
            this.baseLogger.fatal({ event: 'vps_no_clients_initialized' }, "VPS: No Gemini API clients were successfully initialized. VPS will be unable to process requests.");
        }
    }

    /**
     * Chọn API key dựa trên apiType từ server chính.
     * Logic này phải khớp với cách server chính xoay key nếu VPS có nhiều key.
     * Ví dụ đơn giản: determine/cfp dùng key 0, extract dùng key 1.
     */
    private selectKeyIdForApiType(apiType: string): string {
        let keyIndex = 0; // Default to the first key

        if (this.vpsApiKeys.length === 0) {
             this.baseLogger.error({event: "vps_select_key_no_keys_available"}, "VPS: No API keys available to select from.");
             throw new Error("VPS: No API keys available.");
        }

        if (this.vpsApiKeys.length > 1) { // Chỉ áp dụng logic nếu có nhiều hơn 1 key
            if (apiType === 'extract') {
                keyIndex = 1; // extract dùng key thứ hai (index 1)
            } else { // determine, cfp và các loại khác (nếu có) dùng key đầu tiên (index 0)
                keyIndex = 0;
            }
        }
        
        // Đảm bảo keyIndex nằm trong phạm vi
        if (keyIndex >= this.vpsApiKeys.length) {
            this.baseLogger.warn({ event: 'vps_key_index_out_of_bounds', requestedIndex: keyIndex, maxIndex: this.vpsApiKeys.length -1, apiType }, `VPS: Requested key index for ${apiType} is out of bounds. Falling back to key_0.`);
            keyIndex = 0; // Fallback an toàn
        }
         if (!this.genAIInstances.has(`key_${keyIndex}`)) {
            this.baseLogger.error({ event: 'vps_selected_key_instance_missing', keyId: `key_${keyIndex}`, apiType }, `VPS: GenAI instance for selected key ${keyIndex} (apiType: ${apiType}) is missing. This should not happen if keys were initialized.`);
            // Fallback to the first available initialized key if possible
            if (this.genAIInstances.size > 0) {
                const firstAvailableKeyId = this.genAIInstances.keys().next().value;
                 this.baseLogger.warn({event: 'vps_falling_back_to_first_available_key', fallbackKeyId: firstAvailableKeyId}, `Falling back to the first available key: ${firstAvailableKeyId}`);
                return firstAvailableKeyId;
            }
            throw new Error(`VPS: No GenAI instance available for key ${keyIndex} or any other key.`);
        }


        return `key_${keyIndex}`;
    }

    public getGenerativeModel(
        apiType: string, // Server chính gửi apiType để VPS chọn key
        modelName: string,
        systemInstruction: Content | undefined,
        generationConfig: SDKGenerationConfig
    ): GenerativeModel {
        const keyId = this.selectKeyIdForApiType(apiType);
        const genAI = this.genAIInstances.get(keyId);

        if (!genAI) {
            this.baseLogger.error({ event: 'vps_get_genai_failed', keyId, apiType }, `VPS: GoogleGenerativeAI client for ${keyId} (apiType: ${apiType}) is not initialized.`);
            throw new Error(`VPS: GenAI client for ${keyId} (apiType: ${apiType}) not found.`);
        }
        // VPS Logger (tối thiểu)
        // this.baseLogger.debug({ event: 'vps_getting_model', modelName, keyId, apiType }, `VPS: Getting generative model ${modelName} using ${keyId} for ${apiType}`);
        return genAI.getGenerativeModel({
            model: modelName,
            systemInstruction,
            generationConfig,
        });
    }
}