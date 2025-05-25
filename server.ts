import 'reflect-metadata'; // Phải ở trên cùng
import express from 'express';
import { container } from 'tsyringe';
import { VpsConfigService } from './config/vpsConfig.service';
import { LoggingService } from './services/logging.service';
import { vpsAuthMiddleware } from './middleware/auth.middleware';
import { handleGeminiTask } from './controllers/gemini.controller';

// Services cần được đăng ký với tsyringe nếu chúng là dependency
// Ví dụ:
// import { VpsGeminiTaskService } from './services/vpsGeminiTask.service';
// container.registerSingleton(VpsGeminiTaskService);
// Bạn sẽ cần đăng ký tất cả các service mà VpsGeminiTaskService phụ thuộc vào.

const app = express();
app.use(express.json());

// Khởi tạo các service cơ bản
const configService = container.resolve(VpsConfigService);
const loggingService = container.resolve(LoggingService);
const logger = loggingService.getLogger('vpsServer');

// Ping endpoint
app.get('/ping', (req, res) => {
    res.status(200).send('pong from VPS worker');
});

// API route được bảo vệ
app.post('/api/v1/call-gemini', vpsAuthMiddleware, handleGeminiTask);


const PORT = configService.config.PORT;
app.listen(PORT, () => {
    logger.info(`VPS Gemini Worker is running on port ${PORT}`);
    if (configService.config.VPS_GEMINI_API_KEYS.length > 0) {
        logger.info(`VPS configured with ${configService.config.VPS_GEMINI_API_KEYS.length} API key(s).`);
    } else {
        logger.warn("VPS has no Gemini API keys configured!");
    }
    if (!configService.config.VPS_SHARED_SECRET_FOR_AUTH) {
         logger.fatal("VPS_SHARED_SECRET_FOR_AUTH is NOT SET. VPS will not be able to authenticate requests.");
    } else {
        logger.info("VPS_SHARED_SECRET_FOR_AUTH is configured.");
    }
});