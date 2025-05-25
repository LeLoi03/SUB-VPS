// src/types/crawl/index.ts (SERVER CHÍNH)
import { type UsageMetadata, type Part, type GenerationConfig as SDKGenerationConfig, type Content } from "@google/generative-ai"; // Thêm Content
import { Logger
    
 } from "pino";
export interface GeminiApiParams {
    batch: string; // Prompt
    batchIndex: number;
    title: string;
    acronym: string;
}

export interface ApiResponse {
    responseText: string;
    metaData: UsageMetadata | null;
}

export interface OrchestrationResult extends ApiResponse { // Dùng cho local orchestration
    success: boolean;
    usedFallback: boolean;
    modelActuallyUsed?: string;
    crawlModelActuallyUsed?: CrawlModelType;
    finalErrorType?: string;
    finalErrorDetails?: any;
}

// Payload server chính gửi cho VPS
export interface VpsApiPayload {
    baseParams: {
        batchIndex: number;
        title: string;
        acronym: string;
    };
    apiType: string; // Để VPS chọn API key nếu có nhiều key
    modelName: string; // Model cụ thể để sử dụng
    prompt: string; // Prompt chính
    systemInstruction?: string;
    fewShotParts?: Part[];
    generationConfig: SDKGenerationConfig;
    // crawlModel: CrawlModelType; // Không cần gửi nếu server chính đã xử lý logic tuned/non-tuned
                                // để ra modelName, systemInstruction, fewShotParts, generationConfig cuối cùng
}

// Kết quả trả về từ VPS (phần data nếu thành công)
export interface VpsSdkResult {
    responseText: string;
    metaData: UsageMetadata | null;
    // Không cần modelActuallyUsed từ VPS vì server chính đã biết model gửi đi
}

// Response đầy đủ từ VPS (phải khớp với VpsTaskResponse của VPS)
export interface VpsApiResponse {
    success: boolean;
    data?: VpsSdkResult;
    error?: {
        message: string;
        name?: string;
        stack?: string; // Chỉ nhận nếu VPS gửi (ví dụ: dev mode)
        details?: any; // Ví dụ: { msBeforeNext: number } cho rate limit
    };
}

export type CrawlModelType = 'tuned' | 'non-tuned';

// Các type khác giữ nguyên
export interface InternalCallGeminiApiParams {
    batchPrompt: string;
    batchIndex: number;
    title: string;
    acronym: string;
    apiType: string;
    modelName: string; // Model chính được chọn (primary)
    fallbackModelName?: string; // Model fallback (nếu có)
    crawlModel: CrawlModelType; // 'tuned' or 'non-tuned'
    requestLogDir: string;
}

export interface ModelExecutionConfig {
    systemInstructionText: string;
    fewShotParts: Part[];
    shouldUseCache: boolean;
    finalGenerationConfig: SDKGenerationConfig;
    finalBatchPrompt: string;
    modelRateLimiter: any; // Nên là RateLimiterMemory từ 'rate-limiter-flexible'
    modelPrepResult: ModelPreparationResult;
}

export interface ModelPreparationResult {
    model: any; // GenerativeModel
    contentRequest: any; // GenerateContentRequest | string
    usingCacheActual: boolean;
    currentCache: any | null; // CachedContent
    crawlModelUsed: CrawlModelType;
    modelNameUsed: string;
}

export interface ProcessedGeminiResponse {
    responseText: string;
    metaData: UsageMetadata | null;
}
export interface ExecuteWithRetryResult extends ProcessedGeminiResponse {
    firstAttemptFailed?: boolean;
    finalErrorType?: string;
    errorDetails?: any;
}
export type RetryableGeminiApiCall = (
    limiter: any, // RateLimiterMemory
    modelPreparation: ModelPreparationResult,
    apiType: string,
    attemptLogger: Logger
) => Promise<ProcessedGeminiResponse>;

export interface SdkExecutorParams {
    limiterInstance: any; // RateLimiterMemory
    currentModelPrep: ModelPreparationResult;
    apiType: string;
    batchIndex: number;
    acronym: string;
    title: string;
    crawlModel: CrawlModelType;
    systemInstructionTextToUse: string;
    fewShotPartsToUse: Part[];
    requestLogDir: string;
}