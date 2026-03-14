import { Server, Socket } from 'socket.io';
import { prisma } from '../index';

export const registerSpinHandlers = (io: Server, socket: Socket) => {
    const userId = socket.data.userId;

    socket.on('spin:play', async (data: any, callback: Function) => {
        try {
            const betAmount = Number(data?.betAmount);
            if (!betAmount || betAmount < 10) return callback({ error: "Minimum bet amount is 10" });

            const sysSettings = await prisma.systemSettings.findFirst();
            const bonusPct = sysSettings?.bonusDeductionPct ?? 20;
            const gamesEnabled = sysSettings ? JSON.parse(sysSettings.gamesEnabled) : {};
            if (gamesEnabled.spin === false) return callback({ error: "Game is currently disabled" });

            const result = await prisma.$transaction(async (tx) => {
                const user = await tx.user.findUnique({ where: { id: userId } });
                if (!user) throw new Error("User not found");

                // Check Daily Limit
                const settings = await tx.spinGameSettings.findFirst();
                const maxSpins = settings?.maxSpinsPerDay ?? 3;
                const now = new Date();
                const isSameDay = now.toDateString() === new Date(user.lastSpinDate).toDateString();
                const currentCount = isSameDay ? user.dailySpinCount : 0;
                if (currentCount >= maxSpins) throw new Error("Daily spin limit reached");

                // Calculate splits
                const maxBonusDeduction = betAmount * (bonusPct / 100);
                const bonusDeduction = Math.min(user.bonusBalance, maxBonusDeduction);
                const mainDeduction = betAmount - bonusDeduction;
                if (user.balance < mainDeduction) throw new Error("Insufficient main balance");

                // Weighted Random from DB
                const segments = await tx.spinSegment.findMany({ where: { isVisible: true }, orderBy: { id: 'asc' } });
                if (segments.length === 0) throw new Error("No spin segments configured");

                const totalWeight = segments.reduce((sum, s) => sum + s.probability, 0);
                let random = Math.random() * totalWeight;
                let selectedSegment = segments[0];
                let segmentIndex = 0;

                for (let i = 0; i < segments.length; i++) {
                    random -= segments[i].probability;
                    if (random <= 0) {
                        selectedSegment = segments[i];
                        segmentIndex = i;
                        break;
                    }
                }

                const multiplier = selectedSegment.value;
                const winAmount = betAmount * multiplier;
                const profit = winAmount - betAmount;

                // Update User
                const updatedUser = await tx.user.update({
                    where: { id: userId },
                    data: {
                        balance: user.balance - mainDeduction + winAmount,
                        bonusBalance: user.bonusBalance - bonusDeduction,
                        dailySpinCount: currentCount + 1,
                        lastSpinDate: now
                    }
                });

                // Transaction Record
                await tx.transaction.create({
                    data: { userId, amount: profit, type: winAmount > 0 ? "game_win" : "game_loss" }
                });

                return {
                    balance: updatedUser.balance,
                    bonusBalance: updatedUser.bonusBalance,
                    segmentIndex,
                    multiplier,
                    winAmount
                };
            });

            callback({
                success: true,
                segmentIndex: result.segmentIndex,
                multiplier: result.multiplier,
                winAmount: result.winAmount,
                balance: result.balance,
                bonusBalance: result.bonusBalance
            });
            
            socket.emit('balance_update', { balance: result.balance, bonusBalance: result.bonusBalance });

        } catch (e: any) {
            console.error("Spin Socket Error:", e);
            callback({ error: e.message || "Internal Server Error" });
        }
    });

    socket.on('spin:status', async (data: any, callback: Function) => {
        try {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (!user) return callback({ error: "User not found" });

            const settings = await prisma.spinGameSettings.findFirst();
            const maxSpins = settings?.maxSpinsPerDay ?? 3;

            const now = new Date();
            const lastSpin = new Date(user.lastSpinDate);
            const isSameDay = now.toDateString() === lastSpin.toDateString();
            const spinsUsed = isSameDay ? user.dailySpinCount : 0;

            // Time until reset (midnight next day)
            const tomorrow = new Date();
            tomorrow.setHours(24, 0, 0, 0);
            const timeUntilReset = tomorrow.getTime() - now.getTime();

            callback({ spinsUsed, maxSpins, timeUntilReset });
        } catch (e) {
            callback({ error: "Internal error" });
        }
    });
};
