// src/container.ts
import 'reflect-metadata';
import { container } from 'tsyringe';

import { VpsConfigService } from './config/vpsConfig.service';
import { LoggingService } from './services/logging.service';
import { VpsGeminiClientManagerService } from './services/vpsClientManager.service';
import { VpsGeminiRateLimiterService } from './services/vpsGeminiRateLimiter.service';
import { VpsGeminiSdkExecutorService } from './services/vpsGeminiSdkExecutor.service';
import { VpsGeminiTaskService } from './services/vpsGeminiTask.service';

container.registerSingleton(VpsConfigService);
container.registerSingleton(LoggingService);
container.registerSingleton(VpsGeminiClientManagerService);
container.registerSingleton(VpsGeminiRateLimiterService);
container.registerSingleton(VpsGeminiSdkExecutorService);
container.registerSingleton(VpsGeminiTaskService);

export default container;