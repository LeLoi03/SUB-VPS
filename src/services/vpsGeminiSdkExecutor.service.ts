// src/services/gemini/geminiSdkExecutor.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { Logger } from 'pino';
import { type GenerateContentResult, type Part, type GenerativeModel, type Content, type GenerationConfig as SDKGenerationConfig, type GenerateContentRequest } from "@google/generative-ai";
import { LoggingService } from './logging.service';
import { VpsModelPreparationResult, VpsSdkExecutionResult, VpsTaskPayload } from '../types/vps.types';
import { VpsGeminiClientManagerService } from './vpsClientManager.service';
import { RateLimiterMemory } from 'rate-limiter-flexible'; // Chỉ cần type

@singleton()
export class VpsGeminiSdkExecutorService {
    private readonly serviceBaseLogger: Logger;

    constructor(
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(VpsGeminiClientManagerService) private clientManager: VpsGeminiClientManagerService,
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger('vps', { service: 'VpsGeminiSdkExecutorService' });
    }

    private prepareModelForVps(payload: VpsTaskPayload): VpsModelPreparationResult {
        const { apiType, modelName, systemInstruction, fewShotParts, generationConfig, prompt } = payload;
        
        let systemInstructionContent: Content | undefined = undefined;
        if (systemInstruction) {
            systemInstructionContent = { role: "system", parts: [{ text: systemInstruction }] };
        }

        const model = this.clientManager.getGenerativeModel(
            apiType,
            modelName,
            systemInstructionContent,
            generationConfig
        );

        let contentRequest: GenerateContentRequest;
        const history: Content[] = [];

        if (fewShotParts && fewShotParts.length > 0) {
            for (let i = 0; i < fewShotParts.length; i += 2) {
                if (fewShotParts[i]) history.push({ role: "user", parts: [fewShotParts[i]] });
                if (fewShotParts[i + 1]) history.push({ role: "model", parts: [fewShotParts[i + 1]] });
            }
        }
        history.push({ role: "user", parts: [{ text: prompt }] });

        contentRequest = {
            contents: history,
            generationConfig: generationConfig, // Luôn gửi generationConfig ở đây
        };
        
        // this.serviceBaseLogger.debug({ event: 'vps_model_prepared', modelName, apiType, hasSystemInstruction: !!systemInstruction, fewShotCount: fewShotParts?.length || 0}, "VPS: Model prepared for SDK call");

        return {
            model,
            contentRequest,
            modelNameUsed: modelName,
        };
    }


    public async executeSdkCall(
        payload: VpsTaskPayload,
        limiterInstance: RateLimiterMemory, // Nhận limiter từ VpsGeminiTaskService
    ): Promise<VpsSdkExecutionResult> { // Trả về VpsSdkExecutionResult
        const { baseParams, apiType, modelName } = payload;
        const prepLogger = this.serviceBaseLogger.child({ op: 'prepareModelForVps', apiType, modelName });

        let modelPrep: VpsModelPreparationResult;
        try {
            modelPrep = this.prepareModelForVps(payload);
        } catch (prepError: any) {
            prepLogger.error({ event: 'vps_model_prep_failed', err: prepError.message, stack: prepError.stack }, "VPS: Failed to prepare model.");
            throw prepError; // Ném lỗi để VpsGeminiTaskService bắt và trả về cho server chính
        }
        
        const rateLimitKey = `vps_${apiType}_${baseParams.batchIndex}_${modelPrep.modelNameUsed}`;
        try {
            // this.serviceBaseLogger.trace({ event: 'vps_rate_limit_consume_attempt', key: rateLimitKey });
            await limiterInstance.consume(rateLimitKey, 1);
            // this.serviceBaseLogger.trace({ event: 'vps_rate_limit_passed', key: rateLimitKey });
        } catch (rlError: any) {
            // this.serviceBaseLogger.warn({ event: 'vps_rate_limit_hit', key: rateLimitKey, msBeforeNext: rlError?.msBeforeNext }, "VPS: Rate limit hit.");
            // Ném lỗi cụ thể để server chính biết đây là lỗi rate limit từ VPS
            const rateLimitError = new Error(`VPS Rate Limit Exceeded: ${rlError.message || 'Too Many Requests'}`);
            rateLimitError.name = "VpsRateLimitError";
            (rateLimitError as any).details = { msBeforeNext: rlError?.msBeforeNext };
            throw rateLimitError;
        }

        let sdkApiResult: GenerateContentResult;
        try {
            // this.serviceBaseLogger.debug({ event: 'vps_generate_content_start', modelName: modelPrep.modelNameUsed }, "VPS: Calling model.generateContent");
            sdkApiResult = await modelPrep.model.generateContent(modelPrep.contentRequest);
            // this.serviceBaseLogger.debug({ event: 'vps_generate_content_success', modelName: modelPrep.modelNameUsed }, "VPS: model.generateContent successful");
        } catch (genError: any) {
            // this.serviceBaseLogger.error({ event: 'vps_generate_content_failed', modelName: modelPrep.modelNameUsed, errName: genError.name, errMsg: genError.message, stack: genError.stack?.substring(0,300) }, "VPS: Error during model.generateContent");
            throw genError; // Ném lỗi để VpsGeminiTaskService bắt
        }

        // Xử lý response cơ bản từ SDK
        const response = sdkApiResult.response;
        const responseText = response.text() || ""; // Lấy text, hoặc rỗng nếu không có
        const metaData = response.usageMetadata || null;

        // Không clean JSON, không ghi file log trên VPS
        // this.serviceBaseLogger.info({ event: 'vps_sdk_call_processed', modelName: modelPrep.modelNameUsed, responseLength: responseText.length, tokens: metaData?.totalTokenCount }, "VPS: SDK call processed.");
        
        return {
            responseText,
            metaData,
        };
    }
}