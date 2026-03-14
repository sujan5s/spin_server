import { Server, Socket } from 'socket.io';
import { prisma } from '../index';

function factorial(n: number): number {
    if (n <= 1) return 1;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
}

function combination(n: number, r: number): number {
    if (r < 0 || r > n) return 0;
    return factorial(n) / (factorial(r) * factorial(n - r));
}

async function calculateMultiplier(mines: number, revealedCount: number): Promise<number> {
    const config = await prisma.minesConfiguration.findFirst();
    if (config?.settings) {
        try {
            const settings = JSON.parse(config.settings);
            const mineSettings = settings[mines.toString()];
            if (Array.isArray(mineSettings)) {
                const idx = revealedCount - 1;
                if (idx >= 0 && idx < mineSettings.length) return parseFloat(Number(mineSettings[idx]).toFixed(2));
            }
        } catch {}
    }
    if (revealedCount === 0) return 1.0;
    const raw = 0.99 * (combination(25, mines) / combination(25 - revealedCount, mines));
    return parseFloat(raw.toFixed(2));
}

const generateMines = (count: number) => {
    const positions = Array.from({ length: 25 }, (_, i) => i);
    for (let i = positions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    return positions.slice(0, count);
};

export const registerMinesHandlers = (io: Server, socket: Socket) => {
    const userId = socket.data.userId;

    socket.on('mines:create', async (data: any, callback: Function) => {
        try {
            const betAmount = Number(data?.betAmount);
            const minesCount = Number(data?.minesCount);

            if (!betAmount || betAmount < 10) return callback({ error: "Minimum bet is 10" });
            if (!minesCount || minesCount < 1 || minesCount > 24) return callback({ error: "Invalid mines count (1-24)" });

            const sysSettings = await prisma.systemSettings.findFirst();
            const bonusPct = sysSettings?.bonusDeductionPct ?? 20;
            const gamesEnabled = sysSettings ? JSON.parse(sysSettings.gamesEnabled) : {};
            if (gamesEnabled.mines === false) return callback({ error: "Game is currently disabled" });

            const result = await prisma.$transaction(async (tx) => {
                const user = await tx.user.findUnique({ where: { id: userId } });
                if (!user) throw new Error("User not found");

                const deductBonus = Math.min(user.bonusBalance, betAmount * (bonusPct / 100));
                const deductMain = betAmount - deductBonus;
                if (user.balance < deductMain) throw new Error("Insufficient funds");

                const updatedUser = await tx.user.update({
                    where: { id: userId },
                    data: { balance: { decrement: deductMain }, bonusBalance: { decrement: deductBonus } }
                });

                await tx.transaction.create({ data: { userId, amount: -betAmount, type: "game_bet_mines" } });

                const mines = generateMines(minesCount);
                const game = await tx.minesGame.create({
                    data: { userId, betAmount, minesCount, mines: JSON.stringify(mines), revealed: JSON.stringify([]), status: "active", multiplier: 1.0, profit: 0 }
                });

                return { game, balance: updatedUser.balance, bonusBalance: updatedUser.bonusBalance };
            });

            const { mines: _, ...safeGame } = result.game as any;
            callback({ success: true, game: safeGame, balance: result.balance, bonusBalance: result.bonusBalance });
            socket.emit('balance_update', { balance: result.balance, bonusBalance: result.bonusBalance });

        } catch (e: any) {
            console.error("Mines Create Error:", e);
            callback({ error: e.message || "Internal Server Error" });
        }
    });

    socket.on('mines:reveal', async (data: any, callback: Function) => {
        try {
            const { gameId, tileIndex } = data;
            if (!gameId || typeof tileIndex !== 'number' || tileIndex < 0 || tileIndex > 24) return callback({ error: "Invalid input" });

            const game = await prisma.minesGame.findUnique({ where: { id: gameId, userId } });
            if (!game || game.status !== "active") return callback({ error: "Invalid game state" });

            const revealed = JSON.parse(game.revealed) as number[];
            const mines = JSON.parse(game.mines) as number[];
            if (revealed.includes(tileIndex)) return callback({ error: "Tile already revealed" });

            if (mines.includes(tileIndex)) {
                await prisma.minesGame.update({ where: { id: gameId }, data: { status: "lost", revealed: JSON.stringify([...revealed, tileIndex]), profit: -game.betAmount } });
                await prisma.transaction.create({ data: { userId, type: "game_loss", amount: 0 } });
                callback({ success: true, status: "lost", mines });
            } else {
                const newRevealed = [...revealed, tileIndex];
                const newMultiplier = await calculateMultiplier(game.minesCount, newRevealed.length);
                const currentProfit = (game.betAmount * newMultiplier) - game.betAmount;
                const updatedGame = await prisma.minesGame.update({ where: { id: gameId }, data: { revealed: JSON.stringify(newRevealed), multiplier: newMultiplier, profit: currentProfit } });
                callback({ success: true, status: "active", multiplier: updatedGame.multiplier, currentPayout: game.betAmount * updatedGame.multiplier, revealed: newRevealed });
            }
        } catch (e: any) {
            console.error("Mines Reveal Error:", e);
            callback({ error: e.message || "Internal Server Error" });
        }
    });

    socket.on('mines:cashout', async (data: any, callback: Function) => {
        try {
            const { gameId } = data;
            if (!gameId) return callback({ error: "Game ID required" });

            const result = await prisma.$transaction(async (tx) => {
                const game = await tx.minesGame.findUnique({ where: { id: gameId, userId } });
                if (!game) throw new Error("Game not found");
                if (game.status !== "active") throw new Error("Game not active");

                const payout = game.betAmount * game.multiplier;
                const profit = payout - game.betAmount;
                const updatedGame = await tx.minesGame.update({ where: { id: gameId }, data: { status: "cashed_out", profit } });
                const user = await tx.user.update({ where: { id: userId }, data: { balance: { increment: payout } } });
                await tx.transaction.create({ data: { userId, amount: payout, type: "game_win" } });
                return { updatedGame, balance: user.balance, bonusBalance: user.bonusBalance, mines: game.mines, payout };
            });

            callback({ success: true, status: "cashed_out", payout: result.payout, balance: result.balance, mines: JSON.parse(result.mines) });
            socket.emit('balance_update', { balance: result.balance, bonusBalance: result.bonusBalance });

        } catch (e: any) {
            console.error("Mines Cashout Error:", e);
            callback({ error: e.message || "Internal Server Error" });
        }
    });
};
