import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

const prisma = new PrismaClient();

// Resend sends email via HTTPS API — no SMTP sockets, works on Render free tier
const resend = new Resend(process.env.RESEND_API_KEY);

export const sendOtp = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email } = req.body;

        if (!email) {
            res.status(400).json({ error: 'Email is required' });
            return;
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Upsert OTP record
        await prisma.otpVerification.upsert({
            where: { email },
            update: { otp, expiresAt },
            create: { email, otp, expiresAt },
        });

        // Send email via Resend (HTTPS API — no SMTP, works everywhere)
        const fromAddress = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
        const { error } = await resend.emails.send({
            from: `Spin Platform <${fromAddress}>`,
            to: email,
            subject: 'Your OTP for Signup',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 24px; border-radius: 12px; background: #0f0f0f; color: #fff;">
                    <h2 style="color: #a855f7;">Verify your email</h2>
                    <p>Use the code below to complete your signup. It expires in 10 minutes.</p>
                    <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #a855f7; padding: 16px 0;">
                        ${otp}
                    </div>
                    <p style="color: #999; font-size: 12px;">If you didn't request this, ignore this email.</p>
                </div>
            `,
        });

        if (error) {
            console.error('Resend email error:', error);
            res.status(500).json({ error: 'Failed to send OTP', details: error.message });
            return;
        }

        res.json({ message: 'OTP sent successfully' });
    } catch (error: any) {
        console.error('OTP send error:', error);
        res.status(500).json({ error: 'Failed to send OTP', details: String(error) });
    }
};
