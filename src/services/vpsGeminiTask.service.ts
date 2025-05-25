// vps-gemini-worker/src/services/vpsGeminiTask.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { Logger } from 'pino';
import { LoggingService } from './logging.service';
import { VpsConfigService } from '../config/vpsConfig.service'; // Cần cho NODE_ENV khi trả lỗi stack
import { VpsTaskPayload, VpsSdkExecutionResult, VpsTaskResponse } from '../types/vps.types'; // Đảm bảo import đúng type của VPS
import { VpsGeminiSdkExecutorService } from './vpsGeminiSdkExecutor.service';
import { VpsGeminiRateLimiterService } from './vpsGeminiRateLimiter.service';
import { RateLimiterMemory } from 'rate-limiter-flexible'; // Import type đầy đủ nếu cần

@singleton()
export class VpsGeminiTaskService {
    private logger: Logger;
    private readonly nodeEnv: string; // Lưu trữ NODE_ENV

    constructor(
        @inject(LoggingService) loggingService: LoggingService,
        @inject(VpsConfigService) private vpsConfigService: VpsConfigService, // Đổi tên để tránh nhầm với thuộc tính config
        @inject(VpsGeminiSdkExecutorService) private sdkExecutor: VpsGeminiSdkExecutorService,
        @inject(VpsGeminiRateLimiterService) private rateLimiters: VpsGeminiRateLimiterService,
    ) {
        this.logger = loggingService.getLogger('vps', { service: 'VpsGeminiTaskService' });
        this.nodeEnv = this.vpsConfigService.config.NODE_ENV; // Lấy NODE_ENV từ config
        this.logger.info(`VpsGeminiTaskService constructed. NODE_ENV: ${this.nodeEnv}`);
    }

    public async processTask(payload: VpsTaskPayload): Promise<VpsTaskResponse> {
        const { apiType, modelName, baseParams } = payload;
        // VPS không log nhiều, chỉ log khi khởi tạo hoặc lỗi nghiêm trọng
        // Logger có thể được pass vào sdkExecutor nếu sdkExecutor có logging riêng (tuy nhiên theo yêu cầu là VPS không log)

        // Lấy rate limiter cho model name trên VPS
        // VpsGeminiRateLimiterService.getLimiter sẽ trả về RateLimiterMemory
        const limiter: RateLimiterMemory = this.rateLimiters.getLimiter(modelName, this.logger.child({ op: 'getRateLimiter', modelNameForLimiter: modelName }));

        try {
            // sdkExecutor sẽ trả về VpsSdkExecutionResult
            const result: VpsSdkExecutionResult = await this.sdkExecutor.executeSdkCall(payload, limiter);

            // Trả về VpsTaskResponse thành công
            return {
                success: true,
                data: result, // data có kiểu VpsSdkExecutionResult
            };
        } catch (error: any) {
            // Chuẩn bị lỗi để gửi về server chính
            const errorResponse: VpsTaskResponse = {
                success: false,
                error: {
                    message: error.message || "Unknown error during VPS SDK execution.",
                    name: error.name,
                    stack: this.nodeEnv === 'development' ? error.stack : undefined, // Chỉ gửi stack ở dev mode
                    details: error.details || undefined // Ví dụ: cho VpsRateLimitError
                }
            };
            return errorResponse;
        }
    }
}