import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../index';

const JWT_SECRET = process.env.JWT_SECRET || "default-secret-key";

export const socketAuthMiddleware = async (socket: Socket, next: (err?: Error) => void) => {
    try {
        // Token can be sent in handshake auth payload
        const token = socket.handshake.auth?.token;

        if (!token) {
            return next(new Error('Authentication error: No token provided'));
        }

        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        const userId = Number(decoded.userId);

        if (!userId) {
            return next(new Error('Authentication error: Invalid token structure'));
        }

        // Optional: Verify user exists in DB
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return next(new Error('Authentication error: User not found'));
        }

        // Attach user info to the socket instance
        socket.data.user = user;
        socket.data.userId = userId;

        next();
    } catch (error) {
        console.error("Socket authentication failed:", error);
        next(new Error('Authentication error: Invalid or expired token'));
    }
};
