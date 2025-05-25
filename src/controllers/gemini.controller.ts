// vps-gemini-worker/src/controllers/gemini.controller.ts
import { Request, Response } from 'express';
import { container } from 'tsyringe';
import { VpsGeminiTaskService } from '../services/vpsGeminiTask.service';
import { VpsTaskPayload, VpsTaskResponse } from '../types/vps.types';
import { LoggingService } from '../services/logging.service';

export const handleGeminiTask = async (req: Request, res: Response) => {
    const loggingService = container.resolve(LoggingService); // Vẫn cần logger cho controller
    const controllerLogger = loggingService.getLogger('vps', { controller: 'geminiTaskHandler' });
    
    const payload = req.body as VpsTaskPayload;

    // Validate payload cơ bản (quan trọng)
    if (!payload || !payload.baseParams || !payload.apiType || !payload.modelName || !payload.prompt || !payload.generationConfig) {
        controllerLogger.warn({ bodyReceived: req.body, event: 'vps_invalid_payload_structure' }, "VPS: Invalid payload structure received.");
        return res.status(400).json({ success: false, error: { message: 'Invalid payload structure.' } } as VpsTaskResponse);
    }
    
    // controllerLogger.debug({ event: 'vps_task_request_handling', apiType: payload.apiType, modelName: payload.modelName }, "VPS: Handling task request.");

    const taskService = container.resolve(VpsGeminiTaskService);
    try {
        const vpsResult: VpsTaskResponse = await taskService.processTask(payload);
        
        if (vpsResult.success) {
            // controllerLogger.debug({ event: 'vps_task_processed_success', apiType: payload.apiType }, "VPS: Task processed successfully by service.");
            return res.status(200).json(vpsResult);
        } else {
            // controllerLogger.warn({ event: 'vps_task_processed_failure', apiType: payload.apiType, error: vpsResult.error }, "VPS: Task processing failed in service.");
            // Trả về 200 nhưng success: false và có object error
            return res.status(200).json(vpsResult); 
        }
    } catch (error: any) { // Lỗi bất ngờ trong controller
        controllerLogger.error({ event: 'vps_controller_exception', errName: error.name, errMsg: error.message, stack: error.stack }, "VPS: Unhandled exception in controller.");
        return res.status(500).json({ 
            success: false, 
            error: { 
                message: 'Internal VPS server error in controller.',
                name: error.name
            }
        } as VpsTaskResponse);
    }
};