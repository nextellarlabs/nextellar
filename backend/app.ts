import express, { Request, Response, NextFunction } from 'express';
import userRouter from './routes/users.js';
import ordersRouter from './routes/orders.js';
import healthRouter from './routes/health.js';
import searchRouter from './routes/search.js';
import authRouter from './routes/auth.js';
import shippingRouter from './routes/shipping.js';
import transferRouter from './routes/transfer.js';
import settingsRouter from './routes/settings.js';
import accountRouter from './routes/account.js';
import paymentsRouter from './routes/payments.js';
import { globalErrorHandler } from './middleware/errorHandler.js';

const app = express();
app.use(express.json());

app.use('/health', healthRouter);
app.use('/search', searchRouter);
app.use('/users', userRouter);
app.use('/orders', ordersRouter);
app.use('/auth', authRouter);
app.use('/shipping', shippingRouter);
app.use('/transfer', transferRouter);
app.use('/settings', settingsRouter);
app.use('/account', accountRouter);
app.use('/payments', paymentsRouter);

// Global Error Handler
app.use(globalErrorHandler);

export default app;
