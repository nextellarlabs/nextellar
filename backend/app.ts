import express from 'express';
import userRouter from './routes/users.js';

const app = express();
app.use(express.json());

app.use('/users', userRouter);

export default app;
