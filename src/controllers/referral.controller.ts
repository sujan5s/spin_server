import { Request, Response } from 'express';
import { prisma } from '../index';
import { getCurrentUser } from '../services/auth.service';
import { nanoid } from 'nanoid';

export const getReferralStats = async (req: Request, res: Response): Promise<void> => {
    try {
        const cookieHeader = req.headers.cookie;
        const token = cookieHeader?.split('; ').find(row => row.startsWith('token='))?.split('=')[1];
        if (!token) { res.status(401).json({ error: "Not authenticated" }); return; }

        const currentUser = await getCurrentUser(token);

        let user = await prisma.user.findUnique({
            where: { id: currentUser.id },
            include: { referrals: true }
        });

        if (!user) { res.status(404).json({ error: "User not found" }); return; }

        if (!user.referralCode) {
            const code = nanoid(8);
            user = await prisma.user.update({
                where: { id: currentUser.id },
                data: { referralCode: code },
                include: { referrals: true }
            });
        }

        const referralCount = user.referrals.length;
        const earnings = await prisma.transaction.aggregate({
            where: { userId: user.id, type: "referral_bonus" },
            _sum: { amount: true }
        });

        res.json({
            referralCode: user.referralCode,
            referralLink: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/signup?ref=${user.referralCode}`,
            referralCount,
            totalEarnings: earnings._sum.amount || 0,
            hasReferrer: !!user.referredById
        });

    } catch (error: any) {
        console.error("Referral API Error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
