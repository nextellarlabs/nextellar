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
<<<<<<< HEAD
import checkoutRouter from './routes/checkout.js';
=======
import paymentsRouter from './routes/payments.js';
import feedbackRouter from './routes/feedback.js';
>>>>>>> upstream/main
import { globalErrorHandler } from './middleware/errorHandler.js';

const app = express();
app.use(express.json());

<<<<<<< HEAD
<<<<<<< HEAD
app.use('/health', healthRouter);
app.use('/search', searchRouter);
app.use('/users', userRouter);
app.use('/orders', ordersRouter);
app.use('/auth', authRouter);
app.use('/shipping', shippingRouter);
app.use('/transfer', transferRouter);
app.use('/settings', settingsRouter);
app.use('/account', accountRouter);
app.use('/checkout', checkoutRouter);
=======
=======
// Versioned API routes
>>>>>>> upstream/main
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
v1.use('/payments', paymentsRouter);

// Mount versioned routes
app.use('/v1', v1);

// Handle old (non-versioned) routes
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `This endpoint has moved. Please use /v1${req.path} instead.`,
  });
});
>>>>>>> upstream/main

// Global Error Handler
app.use(globalErrorHandler);

export default app;