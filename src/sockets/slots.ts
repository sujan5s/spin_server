import { Server, Socket } from 'socket.io';
import { prisma } from '../index';

const SYMBOLS = ['clover', 'cherry', 'bell', 'diamond', '7'] as const;
type SymbolType = typeof SYMBOLS[number];

const WEIGHTS: Record<SymbolType, number> = { 'clover': 50, 'cherry': 40, 'bell': 30, 'diamond': 15, '7': 5 };
const PAYTABLE: Record<SymbolType, { 3: number, 4: number, 5: number }> = {
    'clover':  { 3: 2,  4: 5,   5: 10   },
    'cherry':  { 3: 3,  4: 8,   5: 15   },
    'bell':    { 3: 5,  4: 15,  5: 30   },
    'diamond': { 3: 10, 4: 30,  5: 60   },
    '7':       { 3: 50, 4: 200, 5: 1000 }
};

export const registerSlotsHandlers = (io: Server, socket: Socket) => {
    const userId = socket.data.userId;

    socket.on('slots:spin', async (data: any, callback: Function) => {
        try {
            const betAmount = Number(data?.betAmount);
            if (!betAmount || betAmount <= 0) return callback({ error: "Invalid bet amount" });

            const sysSettings = await prisma.systemSettings.findFirst();
            const bonusPct = sysSettings?.bonusDeductionPct ?? 20;
            const gamesEnabled = sysSettings ? JSON.parse(sysSettings.gamesEnabled) : {};
            if (gamesEnabled.slots === false) return callback({ error: "Game is currently disabled" });

            let weights = WEIGHTS as any;
            let paytable = PAYTABLE as any;
            const config = await prisma.slotsConfiguration.findFirst();
            if (config?.settings) {
                try { const s = JSON.parse(config.settings); if (s.weights) weights = s.weights; if (s.paytable) paytable = s.paytable; } catch {}
            }

            const totalWeight = Object.values(weights).reduce((a: any, b: any) => Number(a) + Number(b), 0) as number;
            const reels: string[] = [];
            for (let i = 0; i < 5; i++) {
                let random = Math.random() * totalWeight;
                let selected: SymbolType = 'clover';
                for (const sym of SYMBOLS) { random -= (weights[sym] || 0); if (random < 0) { selected = sym; break; } }
                reels.push(selected);
            }

            const firstSymbol = reels[0] as SymbolType;
            let matchCount = 1;
            for (let i = 1; i < 5; i++) { if (reels[i] === firstSymbol) matchCount++; else break; }

            let multiplier = 0;
            if (matchCount >= 3) multiplier = paytable[firstSymbol]?.[matchCount] || 0;
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

            const winType = matchCount >= 5 ? 'jackpot' : matchCount === 4 ? 'big' : matchCount === 3 ? 'small' : 'none';
            callback({ success: true, reels, winAmount, multiplier, matchCount, winType, winningSymbol: matchCount >= 3 ? firstSymbol : null, balance: result.balance, bonusBalance: result.bonusBalance });
            socket.emit('balance_update', { balance: result.balance, bonusBalance: result.bonusBalance });

        } catch (e: any) {
            console.error("Slots Spin Error:", e);
            callback({ error: e.message || "Internal Server Error" });
        }
    });
};
