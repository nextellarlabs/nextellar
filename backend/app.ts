import express from 'express';
import userRouter from './routes/users.js';
import ordersRouter from './routes/orders.js';

const app = express();
app.use(express.json());

app.use('/users', userRouter);
app.use('/orders', ordersRouter);

export default app;
