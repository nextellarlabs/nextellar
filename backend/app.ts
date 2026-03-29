import express, { Request, Response, NextFunction } from 'express';
import userRouter from './routes/users.js';
import ordersRouter from './routes/orders.js';
import healthRouter from './routes/health.js';
import searchRouter from './routes/search.js';
import { globalErrorHandler } from './middleware/errorHandler.js';

const app = express();
app.use(express.json());

app.use('/health', healthRouter);
app.use('/search', searchRouter);
app.use('/users', userRouter);
app.use('/orders', ordersRouter);

// Global Error Handler
app.use(globalErrorHandler);

export default app;
