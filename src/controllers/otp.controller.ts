import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import dns from 'dns';

// Force Node.js to use IPv4 for DNS resolution
// This is necessary because Render's backend services often fail to route outgoing IPv6 traffic (ENETUNREACH)
dns.setDefaultResultOrder('ipv4first');

const prisma = new PrismaClient();

const transporter = nodemailer.createTransport({
    // Force direct IPv4 connection to bypass Render's broken IPv6 DNS resolution
    host: '142.250.141.108', // smtp.gmail.com IPv4
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    tls: {
        // Required because the SSL certificate is for smtp.gmail.com, not the raw IP
        rejectUnauthorized: false
    }
} as any);

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

        // Send email
        await transporter.sendMail({
            from: `"Spin Platform" <${process.env.EMAIL_USER}>`,
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

        res.json({ message: 'OTP sent successfully' });
    } catch (error: any) {
        console.error('OTP send error:', error);
        res.status(500).json({ error: 'Failed to send OTP', details: String(error) });
    }
};
