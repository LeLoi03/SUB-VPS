// src/services/geminiApi.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { type UsageMetadata } from "@google/generative-ai";
import { ConfigService, type AppConfig } from '../config/vpsConfig.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import path from 'path';
import axios, { AxiosError } from 'axios'; // Thêm axios

import { GeminiCachePersistenceService } from './geminiCachePersistence.service';
import { GeminiResponseHandlerService } from './geminiResponseHandler.service';
import { GeminiApiOrchestratorService } from './geminiApiOrchestrator.service';

import { CrawlModelType } from '../types/crawl/crawl.types';
import { ApiResponse, GeminiApiParams, OrchestrationResult, VpsApiPayload, VpsApiResponse } from '../types/crawl'; // Thêm VpsApiPayload, VpsApiResponse


@singleton()
export class GeminiApiService {
    private readonly serviceBaseLogger: Logger;
    private readonly appConfig: AppConfig;

    public readonly API_TYPE_EXTRACT = 'extract';
    public readonly API_TYPE_DETERMINE = 'determine';
    public readonly API_TYPE_CFP = 'cfp';

    private modelIndices: {
        [apiType: string]: number;
    };

    private serviceInitialized: boolean = false;
    private readonly requestLogDir: string;
    private vpsRequestCounter: number = 0; // Bộ đếm để phân phối tải


    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        // @inject(GeminiClientManagerService) private clientManager: GeminiClientManagerService, // Không dùng trực tiếp
        @inject(GeminiCachePersistenceService) private cachePersistence: GeminiCachePersistenceService,
        @inject(GeminiApiOrchestratorService) private apiOrchestrator: GeminiApiOrchestratorService,
        @inject(GeminiResponseHandlerService) private responseHandler: GeminiResponseHandlerService,
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger('main', { service: 'GeminiApiService' });
        this.serviceBaseLogger.info("Constructing GeminiApiService...");

        this.appConfig = this.configService.config;
        const baseOutputDir = this.configService.baseOutputDir || path.join(process.cwd(), 'outputs');
        this.requestLogDir = path.join(baseOutputDir, 'gemini_api_requests_log');
        this.serviceBaseLogger.info({ requestLogDir: this.requestLogDir }, "Gemini API request logging directory initialized.");

        this.modelIndices = {
            [this.API_TYPE_EXTRACT]: 0,
            [this.API_TYPE_DETERMINE]: 0,
            [this.API_TYPE_CFP]: 0,
        };

        if (this.appConfig.VPS_WORKER_URL) {
            this.serviceBaseLogger.info({
                vpsUrl: this.appConfig.VPS_WORKER_URL,
                enabledFor: this.appConfig.VPS_WORKER_ENABLED_FOR_API_TYPES,
                ratio: this.appConfig.VPS_WORKER_LOAD_RATIO
            }, "VPS Worker integration is configured.");
        }
    }


    private getMethodLogger(parentLogger: Logger | undefined, methodName: string, additionalContext?: object): Logger {
        const base = parentLogger || this.serviceBaseLogger;
        return base.child({ serviceMethod: `GeminiApiService.${methodName}`, ...additionalContext });
    }

    public async init(parentLogger?: Logger): Promise<void> {
        const logger = this.getMethodLogger(parentLogger, 'init');
        if (this.serviceInitialized) {
            logger.debug("GeminiApiService already initialized.");
            return;
        }
        logger.info({ event: 'gemini_service_async_init_start' }, "Running async initialization for GeminiApiService...");
        try {
            await this.cachePersistence.loadMap(this.loggingService.getLogger('main', { service: 'GeminiCachePersistenceService', operation: 'loadMapOnInit' }));
            this.serviceInitialized = true;
            logger.info({ event: 'gemini_service_async_init_complete' }, "GeminiApiService async initialization complete.");
        } catch (error) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            logger.error({ err: errorDetails, event: 'gemini_service_async_init_failed' }, "GeminiApiService async initialization failed.");
        }
    }

    private ensureInitialized(logger: Logger): void {
        if (!this.serviceInitialized) {
            const errorMsg = "GeminiApiService is not initialized. Please call `init()` and await its completion.";
            logger.fatal({ event: 'gemini_service_critically_uninitialized', detail: errorMsg, apiType: (logger.bindings() as any).apiType }, errorMsg);
            throw new Error(errorMsg);
        }
    }

    private async _callApiViaVps(
        params: GeminiApiParams,
        apiType: string,
        initialCrawlModelType: CrawlModelType,
        parentLogger: Logger
    ): Promise<ApiResponse> {
        const vpsLogger = parentLogger.child({ vpsCall: true });
        const defaultApiResponse: ApiResponse = { responseText: "", metaData: null };

        if (!this.appConfig.VPS_WORKER_URL || !this.appConfig.VPS_WORKER_AUTH_TOKEN) {
            vpsLogger.error({ event: 'vps_call_misconfigured' }, "VPS worker URL or auth token not configured. Cannot offload call.");
            return defaultApiResponse; // Hoặc throw error, hoặc fallback to local
        }

        const payload: VpsApiPayload = {
            geminiParams: params,
            apiType,
            crawlModel: initialCrawlModelType
        };

        vpsLogger.info({ event: 'vps_call_attempt', vpsUrl: this.appConfig.VPS_WORKER_URL, apiType }, `Attempting to offload API call to VPS for ${apiType}`);

        try {
            const response = await axios.post<VpsApiResponse>(
                this.appConfig.VPS_WORKER_URL,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-VPS-Auth-Token': this.appConfig.VPS_WORKER_AUTH_TOKEN
                    },
                    timeout: 180000 // Ví dụ timeout 3 phút
                }
            );

            if (response.data && response.data.success) {
                vpsLogger.info({
                    event: 'vps_call_success',
                    apiType,
                    modelUsed: response.data.result?.modelActuallyUsed || 'N/A_VPS',
                    crawlModel: response.data.result?.crawlModelActuallyUsed || 'N/A_VPS',
                    tokens: response.data.result?.metaData?.totalTokenCount,
                }, `VPS call successful for ${apiType}.`);
                // Quan trọng: responseHandler.cleanJsonResponse nên được gọi ở đây nếu VPS không clean
                // Giả sử VPS trả về responseText đã được clean (hoặc không cần clean thêm)
                return {
                    responseText: response.data.result.responseText,
                    metaData: response.data.result.metaData
                };
            } else {
                vpsLogger.error({
                    event: 'vps_call_failed_on_vps',
                    apiType,
                    vpsResponseStatus: response.status,
                    vpsResponseData: response.data
                }, `VPS call for ${apiType} failed on VPS side. Error: ${response.data?.error}`);
                return defaultApiResponse; // Hoặc ném lỗi cụ thể
            }
        } catch (error: any) {
            let errorDetails: any = { message: String(error) };
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                errorDetails = {
                    message: axiosError.message,
                    code: axiosError.code,
                    config: { url: axiosError.config?.url, method: axiosError.config?.method, timeout: axiosError.config?.timeout },
                    response: axiosError.response ? { status: axiosError.response.status, data: axiosError.response.data } : null
                };
            }
            vpsLogger.error({
                event: 'vps_call_network_error',
                apiType,
                err: errorDetails,
            }, `Network error or other issue during VPS call for ${apiType}.`);
            // Có thể implement fallback to local call here if desired
            // For now, just return default error
            return defaultApiResponse;
        }
    }



    private async executeApiCallLogic(
        params: GeminiApiParams,
        apiType: string, // Sử dụng string để khớp với key của modelIndices
        initialCrawlModelType: CrawlModelType, // Đổi tên cho rõ ràng
        parentLogger?: Logger
    ): Promise<ApiResponse> {
        const { batch, batchIndex, title, acronym } = params;
        const methodLogger = this.getMethodLogger(parentLogger, apiType, { batchIndex, title, acronym, apiType, crawlModel: initialCrawlModelType });

        this.ensureInitialized(methodLogger);
        const defaultApiResponse: ApiResponse = { responseText: "", metaData: null };



        // Logic quyết định gửi VPS
        const { VPS_WORKER_URL, VPS_WORKER_ENABLED_FOR_API_TYPES, VPS_WORKER_LOAD_RATIO } = this.appConfig;
        let shouldUseVps = false;
        if (VPS_WORKER_URL &&
            VPS_WORKER_ENABLED_FOR_API_TYPES && VPS_WORKER_ENABLED_FOR_API_TYPES.includes(apiType) &&
            VPS_WORKER_LOAD_RATIO && VPS_WORKER_LOAD_RATIO > 0) {

            this.vpsRequestCounter++;
            if (this.vpsRequestCounter % VPS_WORKER_LOAD_RATIO === 0) {
                shouldUseVps = true;
            }
            if (this.vpsRequestCounter >= 100 * (VPS_WORKER_LOAD_RATIO || 1)) { // Reset counter để tránh overflow
                this.vpsRequestCounter = 0;
            }
        }

        if (shouldUseVps) {
            methodLogger.info({ event: 'dispatch_to_vps', apiType }, `Dispatching API call for ${apiType} to VPS worker.`);
            return this._callApiViaVps(params, apiType, initialCrawlModelType, methodLogger);
        }


        // --- Logic thực thi cục bộ (local execution) ---
        methodLogger.info({ event: 'dispatch_to_local', apiType }, `Executing API call for ${apiType} locally.`);
        let modelList: string[];
        let fallbackModelName: string | undefined;


        switch (apiType) {
            case this.API_TYPE_EXTRACT:
                modelList = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_EXTRACT_TUNED_MODEL_NAMES : this.appConfig.GEMINI_EXTRACT_NON_TUNED_MODEL_NAMES;
                fallbackModelName = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_EXTRACT_TUNED_FALLBACK_MODEL_NAME : this.appConfig.GEMINI_EXTRACT_NON_TUNED_FALLBACK_MODEL_NAME;
                break;
            case this.API_TYPE_DETERMINE:
                modelList = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_DETERMINE_TUNED_MODEL_NAMES : this.appConfig.GEMINI_DETERMINE_NON_TUNED_MODEL_NAMES;
                fallbackModelName = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_DETERMINE_TUNED_FALLBACK_MODEL_NAME : this.appConfig.GEMINI_DETERMINE_NON_TUNED_FALLBACK_MODEL_NAME;
                break;
            case this.API_TYPE_CFP:
                modelList = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_CFP_TUNED_MODEL_NAMES : this.appConfig.GEMINI_CFP_NON_TUNED_MODEL_NAMES;
                fallbackModelName = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_CFP_TUNED_FALLBACK_MODEL_NAME : this.appConfig.GEMINI_CFP_NON_TUNED_FALLBACK_MODEL_NAME;
                break;
            default:
                methodLogger.error({ event: 'gemini_unknown_api_type', apiTypeReceived: apiType }, `Unknown API type: ${apiType}`);
                return defaultApiResponse;
        }

        if (!modelList || modelList.length === 0) {
            methodLogger.error({
                event: 'gemini_model_list_empty_or_missing',
                apiType,
                crawlModel: initialCrawlModelType,
                sourceService: 'GeminiApiService',
            }, `Model list for ${apiType}/${initialCrawlModelType} is empty.`);
            return defaultApiResponse;
        }

        const currentIndex = this.modelIndices[apiType];
        const selectedModelName = modelList[currentIndex];
        this.modelIndices[apiType] = (currentIndex + 1) % modelList.length; // Cập nhật index cho lần gọi sau

        methodLogger.debug({ selectedModel: selectedModelName, fallbackModelName: fallbackModelName || 'N/A', nextIndex: this.modelIndices[apiType], listUsedLength: modelList.length }, "Model selected (round-robin)");

        try {
            const orchestrationResult: OrchestrationResult = await this.apiOrchestrator.orchestrateApiCall({
                batchPrompt: batch, batchIndex, title, acronym,
                apiType, modelName: selectedModelName, fallbackModelName,
                crawlModel: initialCrawlModelType, // Truyền initialCrawlModelType vào orchestrator
                requestLogDir: this.requestLogDir,
            }, methodLogger);

            if (orchestrationResult.success) {
                const cleaningLogger = methodLogger.child({
                    modelUsed: orchestrationResult.modelActuallyUsed,
                    crawlModelUsed: orchestrationResult.crawlModelActuallyUsed,
                    usedFallback: orchestrationResult.usedFallback,
                    sub_op: 'jsonClean'
                });
                const cleanedResponseText = this.responseHandler.cleanJsonResponse(orchestrationResult.responseText, cleaningLogger);

                if (orchestrationResult.responseText && cleanedResponseText === "" && orchestrationResult.responseText !== "{}") {
                    cleaningLogger.warn({
                        event: 'json_clean_empty_from_non_empty',
                        rawResponseSnippet: orchestrationResult.responseText.substring(0, 200),
                        apiType, modelUsed: orchestrationResult.modelActuallyUsed
                    }, `JSON cleaning resulted in empty string from non-empty input for ${apiType}.`);
                } else if (cleanedResponseText !== orchestrationResult.responseText) {
                    cleaningLogger.debug({ event: 'json_clean_applied', apiType }, `Successfully cleaned JSON response for ${apiType}.`);
                } else {
                    cleaningLogger.trace({ event: 'json_clean_not_needed', apiType }, `JSON response for ${apiType} did not require cleaning.`);
                }
                // Đặc biệt cho determineLinks và cfp, kiểm tra cấu trúc JSON sau khi clean
                if (apiType === this.API_TYPE_DETERMINE || apiType === this.API_TYPE_CFP) {
                    if (!cleanedResponseText && orchestrationResult.responseText) { // Nếu clean làm rỗng
                        const originalFirstCurly = orchestrationResult.responseText.indexOf('{');
                        const originalLastCurly = orchestrationResult.responseText.lastIndexOf('}');
                        if (originalFirstCurly !== -1 && originalLastCurly !== -1 && originalLastCurly >= originalFirstCurly) {
                            cleaningLogger.warn({ rawResponseSnippet: orchestrationResult.responseText.substring(0, 200), event: `json_clean_parse_failed_after_clean_for_${apiType}` }, `Failed to parse ${apiType} text as JSON after cleaning (resulted in empty).`);
                        } else {
                            cleaningLogger.warn({ rawResponseSnippet: orchestrationResult.responseText.substring(0, 200), event: `json_clean_structure_not_found_after_clean_for_${apiType}` }, `No JSON structure in ${apiType} response after cleaning (resulted in empty).`);
                        }
                    } else if (cleanedResponseText) {
                        try {
                            JSON.parse(cleanedResponseText);
                            cleaningLogger.debug({ event: `json_clean_final_valid_for_${apiType}` }, `Cleaned response for ${apiType} is valid JSON.`);
                        } catch (e) {
                            cleaningLogger.error({ rawResponseSnippet: cleanedResponseText.substring(0, 200), event: `json_clean_final_invalid_for_${apiType}` }, `Cleaned response for ${apiType} is NOT valid JSON.`);
                        }
                    }
                }


                methodLogger.info({
                    event: 'gemini_public_method_finish_local', // Thay đổi event để phân biệt
                    apiType,
                    modelUsed: orchestrationResult.modelActuallyUsed,
                    crawlModel: orchestrationResult.crawlModelActuallyUsed,
                    isFallbackSuccess: orchestrationResult.usedFallback,
                    cleanedResponseLength: cleanedResponseText.length,
                    tokens: orchestrationResult.metaData?.totalTokenCount,
                }, `${apiType} API call (local) finished successfully.`);
                return { responseText: cleanedResponseText, metaData: orchestrationResult.metaData };
            } else {
                methodLogger.error({
                    event: 'gemini_public_method_orchestration_failed_local', // Thay đổi event
                    apiType,
                    selectedModel: selectedModelName,
                    initialCrawlModel: initialCrawlModelType,
                    finalErrorType: orchestrationResult.finalErrorType,
                    finalErrorDetails: orchestrationResult.finalErrorDetails,
                    sourceService: 'GeminiApiService.OrchestrationFailedLocal',
                }, `Local orchestration failed for ${apiType}. Final error: ${orchestrationResult.finalErrorType}`);
                return defaultApiResponse;
            }
        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0, 300) } : { details: String(error) };
            methodLogger.error({
                event: 'gemini_public_method_unhandled_error_local', // Thay đổi event
                apiType,
                selectedModel: selectedModelName,
                crawlModel: initialCrawlModelType,
                err: errorDetails,
                sourceService: 'GeminiApiService.InternalErrorLocal',
            }, `Unhandled error in ${apiType} public method (local).`);
            return defaultApiResponse;
        }
    }

    public async extractInformation(params: GeminiApiParams, crawlModel: CrawlModelType, parentLogger?: Logger): Promise<ApiResponse> {
        return this.executeApiCallLogic(params, this.API_TYPE_EXTRACT, crawlModel, parentLogger);
    }

    public async extractCfp(params: GeminiApiParams, crawlModel: CrawlModelType, parentLogger?: Logger): Promise<ApiResponse> {
        return this.executeApiCallLogic(params, this.API_TYPE_CFP, crawlModel, parentLogger);
    }

    public async determineLinks(params: GeminiApiParams, crawlModel: CrawlModelType, parentLogger?: Logger): Promise<ApiResponse> {
        return this.executeApiCallLogic(params, this.API_TYPE_DETERMINE, crawlModel, parentLogger);
    }
}