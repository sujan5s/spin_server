import { Server, Socket } from 'socket.io';
import { prisma } from '../index';

export const registerLuckyDrawHandlers = (io: Server, socket: Socket) => {
    const userId = socket.data.userId;

    socket.on('luckydraw:purchase', async (data: any, callback: Function) => {
        try {
            const amount = Number(data?.amount);
            if (!amount || amount <= 0) return callback({ error: "Invalid amount" });

            const sysSettings = await prisma.systemSettings.findFirst();
            const gamesEnabled = sysSettings ? JSON.parse(sysSettings.gamesEnabled) : {};
            if (gamesEnabled.luckydraw === false) return callback({ error: "Lucky Draw is currently disabled" });

            const result = await prisma.$transaction(async (tx) => {
                const user = await tx.user.findUnique({ where: { id: userId } });
                if (!user) throw new Error("User not found");
                if (user.balance < amount) throw new Error("Insufficient balance");

                const updatedUser = await tx.user.update({
                    where: { id: userId },
                    data: { balance: { decrement: amount } }
                });

                // Generate a random token number logic (similar to original)
                const tokenNumber = Math.random().toString(36).substring(2, 10).toUpperCase();

                const ticket = await tx.ticket.create({
                    data: {
                        userId,
                        tokenNumber,
                        price: amount,
                        status: "active"
                    }
                });

                await tx.transaction.create({
                    data: {
                        userId,
                        amount: -amount,
                        type: "lucky_draw_purchase"
                    }
                });

                return { ticket, balance: updatedUser.balance, bonusBalance: updatedUser.bonusBalance };
            });

            callback({ success: true, ticket: result.ticket, balance: result.balance, bonusBalance: result.bonusBalance });
            socket.emit('balance_update', { balance: result.balance, bonusBalance: result.bonusBalance });

        } catch (e: any) {
            console.error("LuckyDraw Purchase Error:", e);
            callback({ error: e.message || "Internal error" });
        }
    });

    socket.on('luckydraw:get_tickets', async (data: any, callback: Function) => {
        try {
            const tickets = await prisma.ticket.findMany({
                where: { userId },
                orderBy: { purchasedAt: 'desc' },
                take: 50
            });
            callback({ tickets });
        } catch (e) {
            callback({ error: "Failed to fetch tickets" });
        }
    });
};
