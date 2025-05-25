// vps-gemini-worker/src/server.ts
import 'reflect-metadata'; // Phải ở trên cùng
import express from 'express';
import cors from 'cors'; // <<< THÊM IMPORT NÀY
import { container } from 'tsyringe';
import { VpsConfigService } from './config/vpsConfig.service';
import { LoggingService } from './services/logging.service';
// import { vpsAuthMiddleware } from './middleware/auth.middleware'; // Bạn có thể vẫn muốn dùng auth này
import { handleGeminiTask } from './controllers/gemini.controller';

// --- Đăng ký các services với tsyringe ---
// Quan trọng: Đảm bảo tất cả các service và dependencies của chúng được đăng ký
// trước khi chúng được resolve.
// Ví dụ:
import { VpsGeminiTaskService } from './services/vpsGeminiTask.service';
import { VpsGeminiSdkExecutorService } from './services/vpsGeminiSdkExecutor.service';
import { VpsGeminiClientManagerService } from './services/vpsClientManager.service';
import { VpsGeminiRateLimiterService } from './services/vpsGeminiRateLimiter.service'; // Nếu bạn dùng

container.registerSingleton(VpsConfigService);
container.registerSingleton(LoggingService);
container.registerSingleton(VpsGeminiClientManagerService); // Phụ thuộc VpsConfigService, LoggingService
container.registerSingleton(VpsGeminiRateLimiterService); // Phụ thuộc VpsConfigService, LoggingService
container.registerSingleton(VpsGeminiSdkExecutorService); // Phụ thuộc LoggingService, VpsGeminiClientManagerService
container.registerSingleton(VpsGeminiTaskService);      // Phụ thuộc LoggingService, VpsConfigService, VpsGeminiSdkExecutorService, VpsGeminiRateLimiterService
// -------------------------------------------

const app = express();

// --- Middlewares ---
// 1. CORS Middleware - Cho phép tất cả các nguồn
// Đặt middleware này LÊN TRÊN các route của bạn
app.use(cors()); // Mặc định sẽ cho phép tất cả các origin ('*')

// 2. JSON Parser
app.use(express.json());
// --------------------


// Khởi tạo các service cơ bản sau khi đăng ký
const configService = container.resolve(VpsConfigService);
const loggingService = container.resolve(LoggingService);
const logger = loggingService.getLogger('vpsServer');

// Ping endpoint
app.get('/ping', (req, res) => {
    res.status(200).send('pong from VPS worker');
});

// API route
// Nếu bạn muốn bảo vệ route này, hãy thêm lại vpsAuthMiddleware
// Ví dụ: app.post('/api/v1/call-gemini', vpsAuthMiddleware, handleGeminiTask);
app.post('/api/v1/call-gemini', handleGeminiTask);


const PORT = configService.config.PORT;
app.listen(PORT, () => {
    logger.info(`VPS Gemini Worker is running on port ${PORT}`);
    if (configService.config.VPS_GEMINI_API_KEYS.length > 0) {
        logger.info(`VPS configured with ${configService.config.VPS_GEMINI_API_KEYS.length} API key(s).`);
    } else {
        logger.warn("VPS has no Gemini API keys configured! It may not be able to call Gemini.");
    }
    if (!configService.config.VPS_SHARED_SECRET_FOR_AUTH) {
         logger.fatal("VPS_SHARED_SECRET_FOR_AUTH is NOT SET. Requests from main server might be unauthenticated if auth middleware is used.");
    } else {
        logger.info("VPS_SHARED_SECRET_FOR_AUTH is configured.");
    }
});