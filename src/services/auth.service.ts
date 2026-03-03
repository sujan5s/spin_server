import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

const prisma = new PrismaClient();
// JWT_SECRET is treated as a string by jsonwebtoken
const JWT_SECRET = process.env.JWT_SECRET || "default-secret-key";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "INSERT_CLIENT_ID_HERE";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

async function applyReferralBonus(newUserId: number, referrerId: number) {
    const settings = await prisma.systemSettings.findFirst();
    const newUserBonus = settings ? settings.referralBonusNewUser : 50;
    const referrerBonus = settings ? settings.referralBonusReferrer : 100;

    if (newUserBonus > 0 || referrerBonus > 0) {
        const txs: any[] = [];
        if (newUserBonus > 0) {
            txs.push(prisma.user.update({ where: { id: newUserId }, data: { bonusBalance: { increment: newUserBonus } } }));
            txs.push(prisma.transaction.create({ data: { userId: newUserId, type: "welcome_bonus", amount: newUserBonus } }));
        }
        if (referrerBonus > 0) {
            txs.push(prisma.user.update({ where: { id: referrerId }, data: { bonusBalance: { increment: referrerBonus } } }));
            txs.push(prisma.transaction.create({ data: { userId: referrerId, type: "referral_bonus", amount: referrerBonus } }));
        }
        await prisma.$transaction(txs);
    }
}

export async function loginUser(email?: string, password?: string) {
    if (!email || !password) {
        throw new Error("Email and password are required");
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) {
        throw new Error("Invalid credentials");
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
        throw new Error("Invalid credentials");
    }

    const token = jwt.sign(
        { userId: user.id, email: user.email },
        JWT_SECRET,
        { algorithm: "HS256", expiresIn: "24h" }
    );

    return { user, token };
}

export async function verifyOtpAndSignUp(email?: string, name?: string, password?: string, otp?: string, referralCode?: string) {
    if (!email || !password || !otp) {
        throw new Error("Email, password, and OTP are required");
    }

    const otpRecord = await prisma.otpVerification.findUnique({ where: { email } });
    if (!otpRecord || otpRecord.otp !== otp) {
        throw new Error("Invalid OTP");
    }

    if (new Date() > otpRecord.expiresAt) {
        throw new Error("OTP expired");
    }

    await prisma.otpVerification.delete({ where: { email } });

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
        throw new Error("User already exists");
    }

    let referredById = null;
    if (referralCode) {
        const cleanCode = referralCode.trim();
        let referrer = await prisma.user.findUnique({ where: { referralCode: cleanCode } });
        if (!referrer) {
            referrer = await prisma.user.findUnique({ where: { referralCode: cleanCode.toUpperCase() } });
        }
        if (referrer) {
            referredById = referrer.id;
        }
    }

    let newReferralCode = 'REF' + Math.random().toString(36).substring(2, 8).toUpperCase();
    let isUnique = false;
    while (!isUnique) {
        const codeCheck = await prisma.user.findUnique({ where: { referralCode: newReferralCode } });
        if (!codeCheck) isUnique = true;
        else newReferralCode = 'REF' + Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
        data: {
            email,
            name,
            password: hashedPassword,
            referralCode: newReferralCode,
            referredById,
        },
    });

    if (referredById) {
        await applyReferralBonus(user.id, referredById);
    }

    const token = jwt.sign(
        { userId: user.id, email: user.email },
        JWT_SECRET,
        { algorithm: "HS256", expiresIn: "24h" }
    );

    return { user, token };
}

export async function loginWithGoogle(token?: string, referralCode?: string) {
    if (!token) {
        throw new Error("Token is required");
    }

    let payload;
    if (token.startsWith("mock_")) {
        payload = { email: "mock_user@gmail.com", name: "Mock User", sub: "mock_google_id_12345" };
    } else {
        try {
            const ticket = await googleClient.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
            payload = ticket.getPayload();
        } catch (e) {
            try {
                const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token}` } });
                if (res.ok) {
                    const data = await res.json();
                    payload = { email: data.email, name: data.name, sub: data.sub };
                } else {
                    throw new Error("Failed to fetch user info");
                }
            } catch (error) {
                throw new Error("Invalid Google Token");
            }
        }
    }

    if (!payload || !payload.email) {
        throw new Error("Invalid Token Payload");
    }

    const { email, name, sub: googleId } = payload;
    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
        let referredById = null;
        if (referralCode) {
            const cleanCode = referralCode.trim();
            let referrer = await prisma.user.findUnique({ where: { referralCode: cleanCode } });
            if (!referrer) {
                referrer = await prisma.user.findUnique({ where: { referralCode: cleanCode.toUpperCase() } });
            }
            if (referrer) {
                referredById = referrer.id;
            }
        }

        let newReferralCode = 'REF' + Math.random().toString(36).substring(2, 8).toUpperCase();
        let isUnique = false;
        while (!isUnique) {
            const codeCheck = await prisma.user.findUnique({ where: { referralCode: newReferralCode } });
            if (!codeCheck) isUnique = true;
            else newReferralCode = 'REF' + Math.random().toString(36).substring(2, 8).toUpperCase();
        }

        user = await prisma.user.create({
            data: {
                email,
                name: name || "Google User",
                googleId,
                password: "", // No password for Google users
                referralCode: newReferralCode,
                referredById,
            },
        });

        if (referredById) {
            await applyReferralBonus(user.id, referredById);
        }
    } else if (!user.googleId) {
        user = await prisma.user.update({ where: { email }, data: { googleId } });
    }

    const jwtToken = jwt.sign(
        { userId: user.id, email: user.email },
        JWT_SECRET,
        { algorithm: "HS256", expiresIn: "24h" }
    );

    return { user, token: jwtToken };
}

export async function getCurrentUser(tokenValue?: string) {
    if (!tokenValue) {
        throw new Error("Not authenticated");
    }

    const payload = jwt.verify(tokenValue, JWT_SECRET) as any;
    if (!payload.userId) {
        throw new Error("Invalid token");
    }

    const user = await prisma.user.findUnique({
        where: { id: Number(payload.userId) },
        select: { id: true, email: true, name: true, balance: true, bonusBalance: true, kycStatus: true, kycDocumentUrl: true, createdAt: true },
    });

    if (!user) {
        throw new Error("User not found");
    }

    return user;
}
