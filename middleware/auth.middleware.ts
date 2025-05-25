import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { VpsConfigService } from '../config/vpsConfig.service';

export function vpsAuthMiddleware(req: Request, res: Response, next: NextFunction) {
    const configService = container.resolve(VpsConfigService);
    const authToken = req.headers['x-vps-auth-token'];

    if (!authToken || authToken !== configService.config.VPS_SHARED_SECRET_FOR_AUTH) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing auth token.' });
    }
    next();
}