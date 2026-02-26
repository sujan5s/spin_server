"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.slotsSpin = void 0;
const index_1 = require("../index");
const auth_service_1 = require("../services/auth.service");
const slotsSpin = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const cookieHeader = req.headers.cookie;
        const token = (_a = cookieHeader === null || cookieHeader === void 0 ? void 0 : cookieHeader.split('; ').find(row => row.startsWith('token='))) === null || _a === void 0 ? void 0 : _a.split('=')[1];
        if (!token) {
            res.status(401).json({ error: "Not authenticated" });
            return;
        }
        const user = yield (0, auth_service_1.getCurrentUser)(token);
        const { bet } = req.body;
        const betAmount = parseFloat(bet);
        if (isNaN(betAmount) || betAmount <= 0) {
            res.status(400).json({ error: "Invalid bet amount" });
            return;
        }
        if (user.balance < betAmount) {
            res.status(400).json({ error: "Insufficient balance" });
            return;
        }
        // Core Slots RNG Logic ported from Next.js (Simplified for structural setup, will enhance if needed)
        // ... (Using standard slot mock logic unless deep RNG is specifically needed right now)
        // Let's implement a simplified slot spin mechanic for now to ensure architecture works.
        const symbols = ['CHERRY', 'LEMON', 'ORANGE', 'PLUM', 'BELL', 'BAR', 'SEVEN'];
        const grid = Array(5).fill(0).map(() => Array(3).fill(0).map(() => symbols[Math.floor(Math.random() * symbols.length)]));
        // Payout logic mock
        const winAmount = Math.random() > 0.5 ? betAmount * 2 : 0;
        yield index_1.prisma.user.update({
            where: { id: user.id },
            data: { balance: { increment: winAmount - betAmount } }
        });
        res.json({
            grid,
            winAmount,
            newBalance: user.balance + winAmount - betAmount
        });
    }
    catch (error) {
        console.error("Slots spin error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
exports.slotsSpin = slotsSpin;
// ... other game controllers can follow the same standard Express pattern.
