import express, { Request, Response, NextFunction } from 'express';
import userRouter from './routes/users.js';
import ordersRouter from './routes/orders.js';
import exportRouter from './routes/export.js';
import { globalErrorHandler } from './middleware/errorHandler.js';

const app = express();
app.use(express.json());

app.use('/users', userRouter);
app.use('/orders', ordersRouter);
app.use('/export', exportRouter);

// Global Error Handler
app.use(globalErrorHandler);

export default app;
