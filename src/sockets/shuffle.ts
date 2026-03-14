import { Server, Socket } from 'socket.io';
import { prisma } from '../index';

export const registerShuffleHandlers = (io: Server, socket: Socket) => {
    const userId = socket.data.userId;

    socket.on('shuffle:play', async (data, callback) => {
        try {
            const betAmount = Number(data?.betAmount);
            if (!betAmount || betAmount < 10) {
                return callback({ error: "Minimum bet is 10" });
            }

            const sysSettings = await prisma.systemSettings.findFirst();
            const bonusPct = sysSettings?.bonusDeductionPct ?? 20;
            const gamesEnabled = sysSettings ? JSON.parse(sysSettings.gamesEnabled) : {};

            if (gamesEnabled.shuffle === false) {
                return callback({ error: "Game is currently disabled" });
            }

            // Fetch multiplier from DB config, fall back to default
            const shuffleConfig = await prisma.shuffleConfiguration.findFirst();
            const multiplier = shuffleConfig?.multiplier ?? 2.90;

            const transactionResult = await prisma.$transaction(async (tx) => {
                const user = await tx.user.findUnique({ where: { id: userId } });
                if (!user) throw new Error("User not found");

                const deductBonus = Math.min(user.bonusBalance, betAmount * (bonusPct / 100));
                const deductMain = betAmount - deductBonus;

                if (user.balance < deductMain) throw new Error("Insufficient funds");

                // Deduct bet
                const updatedUser = await tx.user.update({
                    where: { id: userId },
                    data: {
                        balance: { decrement: deductMain },
                        bonusBalance: { decrement: deductBonus }
                    }
                });

                // Create Game (winningCup is -1 until reveal)
                const game = await tx.shuffleGame.create({
                    data: {
                        userId,
                        betAmount,
                        winningCup: -1,
                        status: "active",
                        multiplier
                    }
                });

                return { game, balance: updatedUser.balance, bonusBalance: updatedUser.bonusBalance };
            });

            // Send back successful creation
            callback({
                success: true,
                gameId: transactionResult.game.id,
                balance: transactionResult.balance,
                bonusBalance: transactionResult.bonusBalance
            });

            // Emit generic balance update
            socket.emit('balance_update', {
                balance: transactionResult.balance,
                bonusBalance: transactionResult.bonusBalance
            });

        } catch (error: any) {
            console.error("Shuffle Play Error:", error);
            callback({ error: error.message || "Internal Server Error" });
        }
    });

    socket.on('shuffle:pick', async (data, callback) => {
        try {
            const { gameId, selectedCup } = data;
            if (gameId === undefined || selectedCup === undefined) {
                return callback({ error: "Missing parameters" });
            }

            const game = await prisma.shuffleGame.findUnique({ where: { id: gameId } });
            if (!game || game.userId !== userId || game.status !== "active") {
                return callback({ error: "Invalid game state" });
            }

            let winAmount = 0;
            let status = "lost";

            // Generate actual outcome NOW securely on the server
            const actualWinningCup = Math.floor(Math.random() * 3);

            if (actualWinningCup === selectedCup) {
                status = "won";
                winAmount = game.betAmount * game.multiplier;
            }

            const transactionResult = await prisma.$transaction(async (tx) => {
                // Update Game
                await tx.shuffleGame.update({
                    where: { id: gameId },
                    data: { status, selectedCup, winningCup: actualWinningCup, payout: winAmount }
                });

                // Update User if won
                let newBalance = 0;
                let newBonusBalance = 0;
                
                if (winAmount > 0) {
                    const u = await tx.user.update({
                        where: { id: userId },
                        data: { balance: { increment: winAmount } }
                    });
                    newBalance = u.balance;
                    newBonusBalance = u.bonusBalance;

                    // Transaction Record
                    await tx.transaction.create({
                        data: {
                            userId,
                            amount: winAmount,
                            type: "game_win"
                        }
                    });
                } else {
                    const u = await tx.user.findUnique({ where: { id: userId } });
                    newBalance = u?.balance || 0;
                    newBonusBalance = u?.bonusBalance || 0;
                }

                return { balance: newBalance, bonusBalance: newBonusBalance };
            });

            // Send result to the specific callback
            callback({
                success: true,
                status,
                winAmount,
                winningCup: actualWinningCup,
                balance: transactionResult.balance
            });

            // Emit global balance update for UI sync
            socket.emit('balance_update', {
                balance: transactionResult.balance,
                bonusBalance: transactionResult.bonusBalance
            });

        } catch (error: any) {
            console.error("Shuffle Pick Error:", error);
            callback({ error: error.message || "Internal Server Error" });
        }
    });
};
