// vps-gemini-worker/src/services/logging.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import pino, { Logger, LevelWithSilent, DestinationStream } from 'pino';
import { VpsConfigService } from '../config/vpsConfig.service'; // Config của VPS

@singleton()
export class LoggingService {
    private readonly baseLogger: Logger;
    private readonly logLevel: LevelWithSilent;

    constructor(@inject(VpsConfigService) configService: VpsConfigService) {
        this.logLevel = configService.config.LOG_LEVEL;

        const transport = pino.transport({
            targets: [
                // Chỉ log ra console nếu LOG_TO_CONSOLE là true (mặc định là false trong schema)
                // hoặc nếu LOG_LEVEL không phải là silent
                ...( (configService.config.NODE_ENV !== 'production' || this.logLevel !== 'silent') ? [{
                    target: 'pino-pretty',
                    options: {
                        colorize: true,
                        levelFirst: true,
                        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
                        ignore: 'pid,hostname',
                    },
                    level: this.logLevel,
                }] : [])
            ],
        });
        
        this.baseLogger = pino({
            level: this.logLevel,
        }, transport);

        this.baseLogger.info(`VPS LoggingService initialized with level: ${this.logLevel}. NODE_ENV: ${configService.config.NODE_ENV}`);
    }

    public getLogger(name: string, bindings?: object): Logger {
        return this.baseLogger.child({ name, ...bindings });
    }
}