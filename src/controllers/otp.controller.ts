import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Send email via Brevo HTTPS API (no SMTP sockets, works on Render free tier)
async function sendEmailViaBrevo(to: string, subject: string, html: string) {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'api-key': process.env.BREVO_API_KEY || '',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            sender: {
                name: 'Spin Platform',
                email: process.env.BREVO_FROM_EMAIL || process.env.EMAIL_USER || 'noreply@spin.com',
            },
            to: [{ email: to }],
            subject,
            htmlContent: html,
        }),
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Brevo API error: ${JSON.stringify(errorData)}`);
    }

    return await response.json();
}

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

        // Send email via Brevo (HTTPS API — works everywhere including Render)
        await sendEmailViaBrevo(
            email,
            'Your OTP for Signup',
            `
                <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 24px; border-radius: 12px; background: #0f0f0f; color: #fff;">
                    <h2 style="color: #a855f7;">Verify your email</h2>
                    <p>Use the code below to complete your signup. It expires in 10 minutes.</p>
                    <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #a855f7; padding: 16px 0;">
                        ${otp}
                    </div>
                    <p style="color: #999; font-size: 12px;">If you didn't request this, ignore this email.</p>
                </div>
            `
        );

        res.json({ message: 'OTP sent successfully' });
    } catch (error: any) {
        console.error('OTP send error:', error);
        res.status(500).json({ error: 'Failed to send OTP', details: String(error) });
    }
};
