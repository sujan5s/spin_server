import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { jwtVerify } from 'jose';

const prisma = new PrismaClient();
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "default-secret-key");

const extractUserId = async (req: Request): Promise<number | null> => {
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } else {
        const cookieHeader = req.headers.cookie;
        token = cookieHeader?.split('; ').find(row => row.startsWith('token='))?.split('=')[1];
    }

    if (!token) return null;

    try {
        const { payload } = await jwtVerify(token, JWT_SECRET);
        return Number(payload.userId);
    } catch {
        return null;
    }
};

export const getNotifications = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = await extractUserId(req);
        if (!userId) {
            res.status(401).json({ error: "Not authenticated" });
            return;
        }

        // @ts-ignore
        const notifications = await prisma.notification.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: 10,
        });

        // @ts-ignore
        const totalCount = await prisma.notification.count({ where: { userId } });
        if (totalCount > 10 && notifications.length > 0) {
            const tenthNotification = notifications[notifications.length - 1];
            if (tenthNotification) {
                // @ts-ignore
                await prisma.notification.deleteMany({
                    where: {
                        userId,
                        createdAt: { lt: tenthNotification.createdAt }
                    }
                });
            }
        }

        res.json(notifications);
    } catch (error) {
        console.error("Fetch notifications error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const createNotification = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = await extractUserId(req);
        if (!userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const { title, message, type } = req.body;

        // @ts-ignore
        const notification = await prisma.notification.create({
            data: {
                userId,
                title,
                message,
                type: type || 'info'
            }
        });

        res.json(notification);
    } catch (error) {
        console.error("Create notification error:", error);
        res.status(500).json({ error: "Failed to create notification" });
    }
};
