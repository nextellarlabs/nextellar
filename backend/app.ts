import express, { Request, Response } from 'express';
import userRouter from './routes/users.js';
import ordersRouter from './routes/orders.js';
import healthRouter from './routes/health.js';
import searchRouter from './routes/search.js';
import authRouter from './routes/auth.js';
import shippingRouter from './routes/shipping.js';
import transferRouter from './routes/transfer.js';
import settingsRouter from './routes/settings.js';
import accountRouter from './routes/account.js';
import checkoutRouter from './routes/checkout.js';
import paymentsRouter from './routes/payments.js';
import feedbackRouter from './routes/feedback.js';
import { globalErrorHandler } from './middleware/errorHandler.js';

const app = express();
app.use(express.json());

// Versioned API routes
const v1 = express.Router();

v1.use('/health', healthRouter);
v1.use('/search', searchRouter);
v1.use('/users', userRouter);
v1.use('/orders', ordersRouter);
v1.use('/auth', authRouter);
v1.use('/shipping', shippingRouter);
v1.use('/transfer', transferRouter);
v1.use('/settings', settingsRouter);
v1.use('/account', accountRouter);
v1.use('/checkout', checkoutRouter); // Integrated from your branch
v1.use('/payments', paymentsRouter); // Kept from upstream
v1.use('/feedback', feedbackRouter); // Kept from upstream

// Mount versioned routes
app.use('/v1', v1);

// Handle old (non-versioned) routes
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `This endpoint has moved. Please use /v1${req.path} instead.`,
  });
});

// Global Error Handler
app.use(globalErrorHandler);

export default app;