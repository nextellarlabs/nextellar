import express, { Request, Response, NextFunction } from 'express';
import userRouter from './routes/users.js';
import { globalErrorHandler } from './middleware/errorHandler.js';

const app = express();
app.use(express.json());

app.use('/users', userRouter);

// Global Error Handler
app.use(globalErrorHandler);

export default app;
