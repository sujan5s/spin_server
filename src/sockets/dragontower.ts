import { Server, Socket } from 'socket.io';
import { prisma } from '../index';

const DEFAULT_DIFFICULTY_CONFIG: Record<string, { cols: number; mines: number; multipliers: number[] }> = {
    "easy":   { cols: 4, mines: 1, multipliers: [1.29, 1.72, 2.29, 3.06, 4.08, 5.45, 7.26, 9.69, 12.93] },
    "medium": { cols: 3, mines: 1, multipliers: [1.45, 2.18, 3.27, 4.91, 7.36, 11.04, 16.56, 24.84, 37.26] },
    "hard":   { cols: 2, mines: 1, multipliers: [1.94, 3.88, 7.76, 15.52, 31.04, 62.08, 124.16, 248.32, 496.64] },
    "expert": { cols: 3, mines: 2, multipliers: [2.91, 8.73, 26.19, 78.57, 235.71, 707.13, 2121.39, 6364.17, 19092.51] },
    "master": { cols: 4, mines: 3, multipliers: [3.88, 15.52, 62.08, 248.32, 993.28, 3973.12, 15892.48, 63569.92, 254279.68] }
};
const ROWS = 9;

async function getMultipliersForDifficulty(difficulty: string): Promise<number[]> {
    const settings = await prisma.dragonTowerSettings.findFirst();
    if (settings) {
        try {
            let mStr = "";
            switch(difficulty) {
                case 'easy': mStr = settings.easyMultipliers; break;
                case 'medium': mStr = settings.mediumMultipliers; break;
                case 'hard': mStr = settings.hardMultipliers; break;
                case 'expert': mStr = settings.expertMultipliers; break;
                case 'master': mStr = settings.masterMultipliers; break;
            }
            if (mStr) {
                const arr = JSON.parse(mStr);
                if (Array.isArray(arr)) return arr.map(Number);
            }
        } catch {}
    }
    return DEFAULT_DIFFICULTY_CONFIG[difficulty]?.multipliers || [];
}

export const registerDragonTowerHandlers = (io: Server, socket: Socket) => {
    const userId = socket.data.userId;

    socket.on('dragontower:create', async (data: any, callback: Function) => {
        try {
            const betAmount = Number(data?.betAmount);
            const difficulty = data?.difficulty ?? "medium";
            if (!betAmount || betAmount < 10) return callback({ error: "Minimum bet is 10" });

            const config = DEFAULT_DIFFICULTY_CONFIG[difficulty];
            if (!config) return callback({ error: "Invalid difficulty" });
            const multipliers = await getMultipliersForDifficulty(difficulty);

            const sysSettings = await prisma.systemSettings.findFirst();
            const bonusPct = sysSettings?.bonusDeductionPct ?? 20;
            const gamesEnabled = sysSettings ? JSON.parse(sysSettings.gamesEnabled) : {};
            if (gamesEnabled.dragontower === false) return callback({ error: "Game is currently disabled" });

            // Generate Tower
            const tower: number[][] = [];
            for (let r = 0; r < ROWS; r++) {
                const row = Array(config.cols).fill(1);
                let placed = 0;
                while (placed < config.mines) {
                    const idx = Math.floor(Math.random() * config.cols);
                    if (row[idx] === 1) { row[idx] = 0; placed++; }
                }
                tower.push(row);
            }

            const result = await prisma.$transaction(async (tx) => {
                const user = await tx.user.findUnique({ where: { id: userId } });
                if (!user) throw new Error("User not found");
                const deductBonus = Math.min(user.bonusBalance, betAmount * (bonusPct / 100));
                const deductMain = betAmount - deductBonus;
                if (user.balance < deductMain) throw new Error("Insufficient funds");

                const updatedUser = await tx.user.update({ where: { id: userId }, data: { balance: { decrement: deductMain }, bonusBalance: { decrement: deductBonus } } });
                const game = await tx.dragonTowerGame.create({
                    data: { userId, betAmount, difficulty, status: "active", currentRow: 0, tower: JSON.stringify(tower), multiplier: 1.0, multipliers: JSON.stringify(multipliers) }
                });
                return { game, balance: updatedUser.balance, bonusBalance: updatedUser.bonusBalance };
            });

            callback({ success: true, gameId: result.game.id, balance: result.balance, bonusBalance: result.bonusBalance, difficulty, config: { cols: config.cols, rows: ROWS, multipliers: multipliers } });
            socket.emit('balance_update', { balance: result.balance, bonusBalance: result.bonusBalance });

        } catch (e: any) {
            console.error("DragonTower Create Error:", e);
            callback({ error: e.message || "Internal Server Error" });
        }
    });

    socket.on('dragontower:reveal', async (data: any, callback: Function) => {
        try {
            const { gameId, tileIndex } = data;
            const game = await prisma.dragonTowerGame.findUnique({ where: { id: gameId } });
            if (!game || game.userId !== userId || game.status !== "active") return callback({ error: "Invalid game" });

            const tower = JSON.parse(game.tower) as number[][];
            const currentRow = game.currentRow;
            if (currentRow >= ROWS) return callback({ error: "Game already finished" });

                const row = tower[currentRow];
                const isSafe = row[tileIndex] === 1;
                const multipliers = game.multipliers ? JSON.parse(game.multipliers) : (await getMultipliersForDifficulty(game.difficulty));

                if (isSafe) {
                    const nextRow = currentRow + 1;
                    const newMultiplier = multipliers[currentRow];

                if (nextRow >= ROWS) {
                    const winAmount = game.betAmount * newMultiplier;
                    const user = await prisma.$transaction(async (tx) => {
                        await tx.dragonTowerGame.update({ where: { id: gameId }, data: { status: "won", currentRow: nextRow, multiplier: newMultiplier } });
                        const u = await tx.user.update({ where: { id: userId }, data: { balance: { increment: winAmount } } });
                        await tx.transaction.create({ data: { userId, amount: winAmount, type: "game_win" } });
                        return u;
                    });
                    callback({ success: true, status: "won", rowContent: row, multiplier: newMultiplier, winAmount });
                    socket.emit('balance_update', { balance: user.balance, bonusBalance: user.bonusBalance });
                } else {
                    await prisma.dragonTowerGame.update({ where: { id: gameId }, data: { currentRow: nextRow, multiplier: newMultiplier } });
                    callback({ success: true, status: "continue", rowContent: row, multiplier: newMultiplier });
                }
            } else {
                await prisma.dragonTowerGame.update({ where: { id: gameId }, data: { status: "lost" } });
                callback({ success: true, status: "lost", rowContent: row, allRows: tower });
            }
        } catch (e: any) {
            console.error("DragonTower Reveal Error:", e);
            callback({ error: e.message || "Internal Server Error" });
        }
    });

    socket.on('dragontower:cashout', async (data: any, callback: Function) => {
        try {
            const { gameId } = data;
            const game = await prisma.dragonTowerGame.findUnique({ where: { id: gameId } });
            if (!game || game.userId !== userId || game.status !== "active") return callback({ error: "Invalid game" });
            if (game.currentRow === 0) return callback({ error: "Must reveal at least one row before cashing out" });

            const config = DEFAULT_DIFFICULTY_CONFIG[game.difficulty];
            const multipliers = game.multipliers ? JSON.parse(game.multipliers) : (await getMultipliersForDifficulty(game.difficulty));
            const currentMultiplier = multipliers[game.currentRow - 1];
            const winAmount = game.betAmount * currentMultiplier;

            const user = await prisma.$transaction(async (tx) => {
                await tx.dragonTowerGame.update({ where: { id: gameId }, data: { status: "cashed_out", multiplier: currentMultiplier } });
                const u = await tx.user.update({ where: { id: userId }, data: { balance: { increment: winAmount } } });
                await tx.transaction.create({ data: { userId, amount: winAmount, type: "game_win" } });
                return u;
            });

            callback({ success: true, status: "cashed_out", winAmount, balance: user.balance });
            socket.emit('balance_update', { balance: user.balance, bonusBalance: user.bonusBalance });

        } catch (e: any) {
            console.error("DragonTower Cashout Error:", e);
            callback({ error: e.message || "Internal Server Error" });
        }
    });
};
