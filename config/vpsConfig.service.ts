// vps-gemini-worker/src/config/vpsConfig.service.ts
import 'reflect-metadata';
import { singleton } from 'tsyringe';
import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';
import { LevelWithSilent } from 'pino';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const vpsEnvSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as [LevelWithSilent, ...LevelWithSilent[]]).default('info'),
    VPS_SHARED_SECRET_FOR_AUTH: z.string().min(1, "VPS_SHARED_SECRET_FOR_AUTH is required"),

    VPS_GEMINI_RATE_LIMIT_POINTS: z.coerce.number().int().positive().default(50),
    VPS_GEMINI_RATE_LIMIT_DURATION: z.coerce.number().int().positive().default(60),
    VPS_GEMINI_RATE_LIMIT_BLOCK_DURATION: z.coerce.number().int().positive().default(30),
});

type VpsAppConfigFromSchema = z.infer<typeof vpsEnvSchema>;

export type VpsAppConfig = VpsAppConfigFromSchema & {
    VPS_GEMINI_API_KEYS: string[]; // Mảng các API key của VPS (load động)
};

@singleton()
export class VpsConfigService {
    public readonly config: VpsAppConfig;

    constructor() {
        try {
            const parsedConfig = vpsEnvSchema.parse(process.env);

            const vpsGeminiApiKeys: string[] = [];
            const vpsGeminiKeyPattern = /^VPS_GEMINI_API_KEY_\d+$/;
            for (const envVar in process.env) {
                if (vpsGeminiKeyPattern.test(envVar) && process.env[envVar]) {
                    vpsGeminiApiKeys.push(process.env[envVar] as string);
                }
            }
            const uniqueVpsGeminiApiKeys = [...new Set(vpsGeminiApiKeys.filter(key => key))]; // Lọc key rỗng

            this.config = {
                ...parsedConfig,
                VPS_GEMINI_API_KEYS: uniqueVpsGeminiApiKeys,
            };

            if (!this.config.VPS_SHARED_SECRET_FOR_AUTH) {
                const errorMsg = "CRITICAL: VPS_SHARED_SECRET_FOR_AUTH is not set.";
                console.error(`❌ VPS FATAL: ${errorMsg}`);
                throw new Error(errorMsg);
            }

            if (this.config.VPS_GEMINI_API_KEYS.length === 0) {
                console.warn("⚠️ VPS WARN: No VPS_GEMINI_API_KEY_N found. VPS cannot call Gemini API.");
                 // Có thể throw lỗi ở đây nếu bắt buộc phải có key
                // throw new Error("VPS_GEMINI_API_KEY_N is required for VPS to function.");
            }

            console.log("✅ VPS Configuration loaded and validated successfully.");
            console.log(`   - VPS NODE_ENV: ${this.config.NODE_ENV}`);
            console.log(`   - VPS Port: ${this.config.PORT}`);
            console.log(`   - VPS Gemini API Keys found: ${this.config.VPS_GEMINI_API_KEYS.length}`);

        } catch (error) {
            if (error instanceof z.ZodError) {
                console.error("❌ VPS Invalid environment variables:", JSON.stringify(error.format(), null, 2));
            } else {
                console.error("❌ VPS Unexpected error loading configuration:", error);
            }
            process.exit(1);
        }
    }
}