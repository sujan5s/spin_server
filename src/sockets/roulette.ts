import { Server, Socket } from 'socket.io';
import { prisma } from '../index';

const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const BLACK_NUMBERS = [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35];

// Default payout multipliers (standard roulette)
const DEFAULT_PAYOUTS = { straight: 36, red: 2, black: 2, even: 2, odd: 2, low: 2, high: 2, dozen: 3, column: 3 };

function calculateWinnings(result: number, bets: Record<string, number>, payouts: typeof DEFAULT_PAYOUTS): number {
    let total = 0;
    const isRed = RED_NUMBERS.includes(result);
    const isBlack = BLACK_NUMBERS.includes(result);
    const isEven = result !== 0 && result % 2 === 0;
    const isOdd = result !== 0 && result % 2 !== 0;
    const isLow = result >= 1 && result <= 18;
    const isHigh = result >= 19 && result <= 36;
    const col1 = result !== 0 && result % 3 === 1;
    const col2 = result !== 0 && result % 3 === 2;
    const col3 = result !== 0 && result % 3 === 0;
    const doz1 = result >= 1 && result <= 12;
    const doz2 = result >= 13 && result <= 24;
    const doz3 = result >= 25 && result <= 36;

    for (const [betType, amount] of Object.entries(bets)) {
        const a = Number(amount);
        if (isNaN(a) || a <= 0) continue;
        if (!isNaN(Number(betType))) { if (Number(betType) === result) total += a * payouts.straight; }
        else if (betType === "red" && isRed) total += a * payouts.red;
        else if (betType === "black" && isBlack) total += a * payouts.black;
        else if (betType === "even" && isEven) total += a * payouts.even;
        else if (betType === "odd" && isOdd) total += a * payouts.odd;
        else if (betType === "low" && isLow) total += a * payouts.low;
        else if (betType === "high" && isHigh) total += a * payouts.high;
        else if (betType === "1st12" && doz1) total += a * payouts.dozen;
        else if (betType === "2nd12" && doz2) total += a * payouts.dozen;
        else if (betType === "3rd12" && doz3) total += a * payouts.dozen;
        else if (betType === "col1" && col1) total += a * payouts.column;
        else if (betType === "col2" && col2) total += a * payouts.column;
        else if (betType === "col3" && col3) total += a * payouts.column;
    }
    return total;
}

export const registerRouletteHandlers = (io: Server, socket: Socket) => {
    const userId = socket.data.userId;

    socket.on('roulette:bet', async (data: any, callback: Function) => {
        try {
            const { bets } = data;
            if (!bets || Object.keys(bets).length === 0) return callback({ error: "No bets placed" });

            const totalBetAmount = Object.values(bets).reduce((a, b) => Number(a) + Number(b), 0) as number;
            if (totalBetAmount <= 0) return callback({ error: "Invalid bet amount" });

            const sysSettings = await prisma.systemSettings.findFirst();
            const bonusPct = sysSettings?.bonusDeductionPct ?? 20;
            const gamesEnabled = sysSettings ? JSON.parse(sysSettings.gamesEnabled) : {};
            if (gamesEnabled.roulette === false) return callback({ error: "Game is currently disabled" });

            // Fetch payout config from DB, fall back to defaults
            let payouts = DEFAULT_PAYOUTS;
            const rouletteConfig = await prisma.rouletteConfiguration.findFirst();
            if (rouletteConfig?.settings) {
                try { const parsed = JSON.parse(rouletteConfig.settings); payouts = { ...DEFAULT_PAYOUTS, ...parsed }; } catch {}
            }

            const resultData = await prisma.$transaction(async (tx) => {
                const user = await tx.user.findUnique({ where: { id: userId } });
                if (!user) throw new Error("User not found");
                const deductBonus = Math.min(user.bonusBalance, totalBetAmount * (bonusPct / 100));
                const deductMain = totalBetAmount - deductBonus;
                if (user.balance < deductMain) throw new Error("Insufficient funds");

                const result = Math.floor(Math.random() * 37);
                const totalWinnings = calculateWinnings(result, bets, payouts);
                const netChange = totalWinnings - totalBetAmount;

                const updatedUser = await tx.user.update({ where: { id: userId }, data: { balance: { increment: totalWinnings - deductMain }, bonusBalance: { decrement: deductBonus } } });
                await tx.transaction.create({ data: { userId, amount: netChange, type: netChange > 0 ? "game_win" : "game_loss" } });
                return { result, totalWinnings, balance: updatedUser.balance, bonusBalance: updatedUser.bonusBalance, netChange };
            });

            callback({ success: true, result: resultData.result, winAmount: resultData.totalWinnings, balance: resultData.balance, bonusBalance: resultData.bonusBalance, netChange: resultData.netChange });
            socket.emit('balance_update', { balance: resultData.balance, bonusBalance: resultData.bonusBalance });

        } catch (e: any) {
            console.error("Roulette Bet Error:", e);
            callback({ error: e.message || "Internal Server Error" });
        }
    });
};
