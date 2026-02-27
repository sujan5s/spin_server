import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "default-secret-key";

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
        const payload = jwt.verify(token, JWT_SECRET) as any;
        return Number(payload.userId);
    } catch {
        return null;
    }
};

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = await extractUserId(req);
        if (!userId) {
            res.status(401).json({ error: "Not authenticated" });
            return;
        }

        const { name } = req.body;

        if (!name) {
            res.status(400).json({ error: "Name is required" });
            return;
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: { name },
            select: { id: true, name: true, email: true, balance: true }
        });

        res.json({ success: true, message: "Profile updated successfully", user: updatedUser });
    } catch (error) {
        console.error("Profile update error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const updatePassword = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = await extractUserId(req);
        if (!userId) {
            res.status(401).json({ error: "Not authenticated" });
            return;
        }

        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            res.status(400).json({ error: "Both current and new passwords are required" });
            return;
        }

        if (newPassword.length < 6) {
            res.status(400).json({ error: "New password must be at least 6 characters" });
            return;
        }

        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }

        if (!user.password) {
            res.status(400).json({ error: "You are logged in via Google. You cannot change password here." });
            return;
        }

        const isValid = await bcrypt.compare(currentPassword, user.password);

        if (!isValid) {
            res.status(401).json({ error: "Incorrect current password" });
            return;
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword }
        });

        res.json({ success: true, message: "Password updated successfully" });
    } catch (error) {
        console.error("Password update error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const deleteAccount = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = await extractUserId(req);
        if (!userId) {
            res.status(401).json({ error: "Not authenticated" });
            return;
        }

        await prisma.$transaction([
            prisma.transaction.deleteMany({ where: { userId } }),
            // @ts-ignore
            prisma.notification.deleteMany({ where: { userId } }),
            // @ts-ignore
            prisma.ticket.deleteMany({ where: { userId } }),
            prisma.user.delete({ where: { id: userId } })
        ]);

        res.clearCookie('token');
        res.json({ success: true, message: "Account deleted successfully" });
    } catch (error) {
        console.error("Delete account error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
