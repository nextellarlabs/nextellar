import { Request, Response, NextFunction } from 'express';

export function globalErrorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
    // Always log errors server-side
    console.error('Unhandled app error:', err);

    const statusCode = (err as any).statusCode || (err as any).status || 500;

    if (process.env.NODE_ENV === 'production') {
        res.status(statusCode).json({
            success: false,
            message: 'Internal Server Error'
        });
    } else {
        res.status(statusCode).json({
            success: false,
            message: err.message,
            stack: err.stack,
        });
    }
}
