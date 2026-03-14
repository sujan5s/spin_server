import { Server, Socket } from 'socket.io';
import { prisma } from '../index';

const PLINKO_MULTIPLIERS: Record<number, Record<string, number[]>> = {
    8:  { low: [5.6,2.1,1.1,1,0.5,1,1.1,2.1,5.6], medium: [13,3,1.3,0.7,0.4,0.7,1.3,3,13], high: [29,4,1.5,0.3,0.2,0.3,1.5,4,29] },
    12: { low: [5.4,2,1.2,1.1,1,0.6,1,1.1,1.2,2,5.4], medium: [33,11,4,2,1.1,0.6,1.1,2,4,11,33], high: [170,24,8.1,2,0.7,0.2,0.7,2,8.1,24,170] },
    16: { low: [5.6,2.1,1.4,1.4,1.2,1.1,1,0.5,1,1.1,1.2,1.4,1.4,2.1,5.6], medium: [110,41,10,5,3,1.5,1,0.5,1,1.5,3,5,10,41,110], high: [1000,130,26,9,4,2,0.2,0.2,0.2,2,4,9,26,130,1000] }
};

export const registerPlinkoHandlers = (io: Server, socket: Socket) => {
    const userId = socket.data.userId;

    socket.on('plinko:play', async (data: any, callback: Function) => {
        try {
            const betAmount = Number(data?.betAmount);
            const rows = Number(data?.rows ?? 16);
            const risk = data?.risk ?? 'medium';

            if (!betAmount || betAmount <= 0) return callback({ error: "Invalid bet amount" });
            if (![8, 12, 16].includes(rows)) return callback({ error: "Invalid row count" });
            if (!['low', 'medium', 'high'].includes(risk)) return callback({ error: "Invalid risk level" });

            const sysSettings = await prisma.systemSettings.findFirst();
            const bonusPct = sysSettings?.bonusDeductionPct ?? 20;
            const gamesEnabled = sysSettings ? JSON.parse(sysSettings.gamesEnabled) : {};
            if (gamesEnabled.plinko === false) return callback({ error: "Game is currently disabled" });

            // Determine Multiplier
            let multiplier: number;
            let resultIndex: number;

            const config = await prisma.plinkoConfiguration.findUnique({ where: { rows_risk: { rows, risk } } });
            if (config?.settings) {
                const settings = JSON.parse(config.settings);
                const totalWeight = settings.reduce((s: number, i: any) => s + i.probability, 0);
                let random = Math.random() * totalWeight;
                let selected = settings[0];
                for (const item of settings) { random -= item.probability; if (random < 0) { selected = item; break; } }
                resultIndex = selected.index;
                multiplier = selected.multiplier;
            } else {
                const mults = (PLINKO_MULTIPLIERS[rows] as any)[risk] as number[];
                const path: number[] = [];
                for (let i = 0; i < rows; i++) path.push(Math.random() > 0.5 ? 1 : 0);
                resultIndex = path.reduce((a, b) => a + b, 0);
                multiplier = mults[Math.min(resultIndex, mults.length - 1)];
            }

            // Generate visual path
            const path: number[] = Array(rows).fill(0);
            for (let i = 0; i < resultIndex; i++) path[i] = 1;
            for (let i = path.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [path[i], path[j]] = [path[j], path[i]]; }

            const winAmount = betAmount * multiplier;
            const profit = winAmount - betAmount;

            const result = await prisma.$transaction(async (tx) => {
                const user = await tx.user.findUnique({ where: { id: userId } });
                if (!user) throw new Error("User not found");
                const deductBonus = Math.min(user.bonusBalance, betAmount * (bonusPct / 100));
                const deductMain = betAmount - deductBonus;
                if (user.balance < deductMain) throw new Error("Insufficient funds");
                const updatedUser = await tx.user.update({ where: { id: userId }, data: { balance: { increment: winAmount - deductMain }, bonusBalance: { decrement: deductBonus } } });
                await tx.transaction.create({ data: { userId, amount: profit, type: profit > 0 ? "game_win" : "game_loss" } });
                return { balance: updatedUser.balance, bonusBalance: updatedUser.bonusBalance };
            });

            callback({ success: true, path, resultIndex, multiplier, winAmount, balance: result.balance, bonusBalance: result.bonusBalance });
            socket.emit('balance_update', { balance: result.balance, bonusBalance: result.bonusBalance });

        } catch (e: any) {
            console.error("Plinko Play Error:", e);
            callback({ error: e.message || "Internal Server Error" });
        }
    });
};
