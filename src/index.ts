import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
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
    process.env.CLIENT_URL,
].filter(Boolean) as string[];

const httpServer = http.createServer(app);
export const io = new SocketIOServer(httpServer, {
    cors: {
        origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
                return callback(null, true);
            }
            callback(new Error('CORS: origin not allowed'));
        },
        credentials: true
    }
});

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

// Setup Socket.IO Server
import { socketAuthMiddleware } from './middlewares/socketAuth';
import { registerShuffleHandlers } from './sockets/shuffle';
import { registerMinesHandlers } from './sockets/mines';
import { registerDragonTowerHandlers } from './sockets/dragontower';
import { registerPlinkoHandlers } from './sockets/plinko';
import { registerSlotsHandlers } from './sockets/slots';
import { registerRouletteHandlers } from './sockets/roulette';
import { registerSpinHandlers } from './sockets/spin';
import { registerLuckyDrawHandlers } from './sockets/luckydraw';

// Use middleware to secure connections
io.use(socketAuthMiddleware);

io.on('connection', (socket) => {
    const userId = socket.data.userId;
    console.log(`User Connected: ${userId} (Socket: ${socket.id})`);

    // Join a private room for user-specific events (like balance updates)
    socket.join(`user_${userId}`);

    socket.on('disconnect', () => {
        console.log(`User Disconnected: ${userId} (Socket: ${socket.id})`);
    });

    // Register Game Handlers
    registerShuffleHandlers(io, socket);
    registerMinesHandlers(io, socket);
    registerDragonTowerHandlers(io, socket);
    registerPlinkoHandlers(io, socket);
    registerSlotsHandlers(io, socket);
    registerRouletteHandlers(io, socket);
    registerSpinHandlers(io, socket);
    registerLuckyDrawHandlers(io, socket);
});

// Only listen when NOT running as a Vercel serverless function
if (!process.env.VERCEL) {
    httpServer.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
}

export default app;
