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

export const deposit = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = await extractUserId(req);
        if (!userId) {
            res.status(401).json({ error: "Not authenticated" });
            return;
        }

        const { amount } = req.body;

        if (!amount || amount <= 0) {
            res.status(400).json({ error: "Invalid amount" });
            return;
        }

        // Update user balance and create transaction
        const result = await prisma.$transaction(async (tx) => {
            const depositCount = await tx.transaction.count({
                where: { userId, type: "deposit" }
            });

            let user = await tx.user.update({
                where: { id: userId },
                data: { balance: { increment: amount } },
                include: { referredBy: true }
            });

            await tx.transaction.create({
                data: { userId, type: "deposit", amount },
            });

            if (depositCount === 0) {
                const REFEREE_BONUS = 50;
                user = await tx.user.update({
                    where: { id: userId },
                    data: { balance: { increment: REFEREE_BONUS } },
                    include: { referredBy: true }
                });

                await tx.transaction.create({
                    data: { userId, type: "welcome_bonus", amount: REFEREE_BONUS }
                });

                if (user.referredById) {
                    const REFERRER_BONUS = 100;
                    await tx.user.update({
                        where: { id: user.referredById },
                        data: { balance: { increment: REFERRER_BONUS } }
                    });

                    await tx.transaction.create({
                        data: { userId: user.referredById, type: "referral_bonus", amount: REFERRER_BONUS }
                    });
                }
            }

            return user;
        });

        res.json({ balance: result.balance });
    } catch (error) {
        console.error("Deposit error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const withdraw = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = await extractUserId(req);
        if (!userId) {
            res.status(401).json({ error: "Not authenticated" });
            return;
        }

        const { amount } = req.body;

        if (!amount || amount <= 0) {
            res.status(400).json({ error: "Invalid amount" });
            return;
        }

        const result = await prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({ where: { id: userId } });
            if (!user) throw new Error("User not found");
            if (user.balance < amount) throw new Error("Insufficient balance");

            const updatedUser = await tx.user.update({
                where: { id: userId },
                data: { balance: { decrement: amount } },
            });

            // @ts-ignore
            await tx.transaction.create({
                data: { userId, type: "withdraw", amount },
            });

            // @ts-ignore
            await tx.notification.create({
                data: {
                    userId,
                    title: "Withdrawal Successful",
                    message: `You have successfully withdrawn $${amount.toFixed(2)}.`,
                    type: "success",
                }
            });

            return { balance: updatedUser.balance, message: "Withdrawal successful" };
        });

        res.json(result);
    } catch (error: any) {
        console.error("Withdraw error:", error);
        if (error.message === "Insufficient balance") {
            res.status(400).json({ error: "Insufficient balance" });
            return;
        }
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getTransactions = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = await extractUserId(req);
        if (!userId) {
            res.status(401).json({ error: "Not authenticated" });
            return;
        }

        const transactions = await prisma.transaction.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
        });

        res.json({ transactions });
    } catch (error) {
        console.error("Transactions error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
