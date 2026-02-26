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
exports.getReferralStats = void 0;
const index_1 = require("../index");
const auth_service_1 = require("../services/auth.service");
const nanoid_1 = require("nanoid");
const getReferralStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const cookieHeader = req.headers.cookie;
        const token = (_a = cookieHeader === null || cookieHeader === void 0 ? void 0 : cookieHeader.split('; ').find(row => row.startsWith('token='))) === null || _a === void 0 ? void 0 : _a.split('=')[1];
        if (!token) {
            res.status(401).json({ error: "Not authenticated" });
            return;
        }
        const currentUser = yield (0, auth_service_1.getCurrentUser)(token);
        let user = yield index_1.prisma.user.findUnique({
            where: { id: currentUser.id },
            include: { referrals: true }
        });
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        if (!user.referralCode) {
            const code = (0, nanoid_1.nanoid)(8);
            user = yield index_1.prisma.user.update({
                where: { id: currentUser.id },
                data: { referralCode: code },
                include: { referrals: true }
            });
        }
        const referralCount = user.referrals.length;
        const earnings = yield index_1.prisma.transaction.aggregate({
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
    }
    catch (error) {
        console.error("Referral API Error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
exports.getReferralStats = getReferralStats;
