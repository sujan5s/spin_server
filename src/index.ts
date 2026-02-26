import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import authRoutes from './routes/auth.routes';
import gameRoutes from './routes/game.routes';
import referralRoutes from './routes/referral.routes';
import walletRoutes from './routes/wallet.routes';
import notificationsRoutes from './routes/notifications.routes';
import settingsRoutes from './routes/settings.routes';

const app = express();
const port = process.env.PORT || 3001;
export const prisma = new PrismaClient();

const allowedOrigins = [
    'http://localhost:3000',
    process.env.CLIENT_URL,           // e.g. https://your-app.vercel.app
].filter(Boolean) as string[];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (e.g. curl, Render health checks)
        if (!origin) return callback(null, true);
        // Allow any vercel.app subdomain or exact matches
        if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
            return callback(null, true);
        }
        callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/settings', settingsRoutes);

app.get('/health', (req: express.Request, res: express.Response) => {
    res.json({ status: 'ok' });
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
