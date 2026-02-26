import { Request, Response } from 'express';
import { loginUser, verifyOtpAndSignUp, loginWithGoogle, getCurrentUser } from '../services/auth.service';

export const login = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, password } = req.body;
        const { user, token } = await loginUser(email, password);

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 24 * 1000 // 24 hours in milliseconds
        });

        res.json({ user, token });
    } catch (error: any) {
        console.error("Login error:", error);

        if (error.message === "Email and password are required") {
            res.status(400).json({ error: error.message });
            return;
        }
        if (error.message === "Invalid credentials") {
            res.status(401).json({ error: error.message });
            return;
        }

        res.status(500).json({ error: "Internal server error" });
    }
};

export const signup = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, name, password, otp, referralCode } = req.body;
        const { user, token } = await verifyOtpAndSignUp(email, name, password, otp, referralCode);

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 24 * 1000
        });

        res.status(201).json({ user, token });
    } catch (error: any) {
        console.error("Signup error:", error);

        if (["Email, password, and OTP are required", "Invalid OTP", "OTP expired", "User already exists"].includes(error.message)) {
            res.status(400).json({ error: error.message });
            return;
        }

        res.status(500).json({ error: "Internal server error" });
    }
};

export const googleLogin = async (req: Request, res: Response): Promise<void> => {
    try {
        const { token: inputToken, referralCode } = req.body;
        const { user, token } = await loginWithGoogle(inputToken, referralCode);

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 24 * 1000
        });

        res.json({ user, token });
    } catch (error: any) {
        console.error("Google Auth Error Details:", error);
        if (["Token is required", "Invalid Google Token", "Invalid Token Payload"].includes(error.message)) {
            res.status(400).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: "Internal server error", details: String(error) });
    }
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
    try {
        // Extract token from Authorization header or cookie
        const authHeader = req.headers.authorization;
        let token: string | undefined;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else {
            const cookieHeader = req.headers.cookie;
            token = cookieHeader?.split('; ').find(row => row.startsWith('token='))?.split('=')[1];
        }

        if (!token) {
            res.status(401).json({ error: "Not authenticated" });
            return;
        }

        const user = await getCurrentUser(token);
        res.json({ user });
    } catch (error: any) {
        console.error("Session check error:", error);
        if (error.message === "User not found") {
            res.status(404).json({ error: error.message });
            return;
        }
        res.status(401).json({ error: "Not authenticated" });
    }
};
