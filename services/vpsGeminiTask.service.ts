// vps-gemini-worker/src/services/vpsGeminiTask.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { Logger } from 'pino';
import { LoggingService } from './logging.service';
import { VpsConfigService } from '../config/vpsConfig.service';
import { VpsTaskPayload, VpsSdkExecutionResult, VpsTaskResponse } from '../types/vps.types';
import { VpsGeminiSdkExecutorService } from './vpsGeminiSdkExecutor.service';
import { VpsGeminiRateLimiterService } from './vpsGeminirateLimiter.service';
@singleton()
export class VpsGeminiTaskService {
    private logger: Logger;

    constructor(
        @inject(LoggingService) loggingService: LoggingService,
        @inject(VpsConfigService) private vpsConfig: VpsConfigService, // Không cần thiết nếu không dùng trực tiếp
        @inject(VpsGeminiSdkExecutorService) private sdkExecutor: VpsGeminiSdkExecutorService,
        @inject(VpsGeminiRateLimiterService) private rateLimiters: VpsGeminiRateLimiterService, // Inject rate limiter
    ) {
        this.logger = loggingService.getLogger('vps', { service: 'VpsGeminiTaskService' });
        this.logger.info("VpsGeminiTaskService constructed.");
    }

    public async processTask(payload: VpsTaskPayload): Promise<VpsTaskResponse> {
        const { apiType, modelName, baseParams } = payload;
        // VPS không log nhiều, chỉ log khi khởi tạo hoặc lỗi nghiêm trọng
        // this.logger.debug({ event: 'vps_task_received', apiType, modelName, acronym: baseParams.acronym }, "VPS: Task received.");

        // Lấy rate limiter cho model (hoặc apiType nếu rate limit theo apiType trên VPS)
        // Giả sử rate limit theo model name trên VPS
        const limiter = this.rateLimiters.getLimiter(modelName, this.logger.child({ op: 'getLimiter' }));


        try {
            const result: VpsSdkExecutionResult = await this.sdkExecutor.executeSdkCall(payload, limiter);
            // this.logger.debug({ event: 'vps_task_success_sdk_execution', apiType, modelName }, "VPS: SDK execution successful.");
            return {
                success: true,
                data: result,
            };
        } catch (error: any) {
            // this.logger.warn({ event: 'vps_task_failed_sdk_execution', apiType, modelName, errName: error.name, errMsg: error.message }, "VPS: SDK execution failed.");
            // Chuẩn bị lỗi để gửi về server chính
            const errorResponse: VpsTaskResponse = {
                success: false,
                error: {
                    message: error.message || "Unknown error during VPS SDK execution.",
                    name: error.name,
                    // Chỉ gửi stack nếu là dev hoặc có cờ debug từ server chính (hiện tại không có)
                    stack: this.vpsConfig.config.NODE_ENV === 'development' ? error.stack : undefined,
                    details: error.details || undefined // Cho VpsRateLimitError
                }
            };
            return errorResponse;
        }
    }
}