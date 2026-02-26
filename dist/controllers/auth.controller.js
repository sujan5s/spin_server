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
exports.getMe = exports.googleLogin = exports.signup = exports.login = void 0;
const auth_service_1 = require("../services/auth.service");
const login = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, password } = req.body;
        const { user, token } = yield (0, auth_service_1.loginUser)(email, password);
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 24 * 1000 // 24 hours in milliseconds
        });
        res.json({ user });
    }
    catch (error) {
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
});
exports.login = login;
const signup = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, name, password, otp, referralCode } = req.body;
        const { user, token } = yield (0, auth_service_1.verifyOtpAndSignUp)(email, name, password, otp, referralCode);
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 24 * 1000
        });
        res.status(201).json({ user });
    }
    catch (error) {
        console.error("Signup error:", error);
        if (["Email, password, and OTP are required", "Invalid OTP", "OTP expired", "User already exists"].includes(error.message)) {
            res.status(400).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: "Internal server error" });
    }
});
exports.signup = signup;
const googleLogin = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { token: inputToken, referralCode } = req.body;
        const { user, token } = yield (0, auth_service_1.loginWithGoogle)(inputToken, referralCode);
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 24 * 1000
        });
        res.json({ user });
    }
    catch (error) {
        console.error("Google Auth Error Details:", error);
        if (["Token is required", "Invalid Google Token", "Invalid Token Payload"].includes(error.message)) {
            res.status(400).json({ error: error.message });
            return;
        }
        res.status(500).json({ error: "Internal server error", details: String(error) });
    }
});
exports.googleLogin = googleLogin;
const getMe = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        // Express doesn't parse cookies automatically unless cookie-parser is used
        // Since we didn't add cookie-parser yet, let's extract it manually for now or add it
        const cookieHeader = req.headers.cookie;
        const token = (_a = cookieHeader === null || cookieHeader === void 0 ? void 0 : cookieHeader.split('; ').find(row => row.startsWith('token='))) === null || _a === void 0 ? void 0 : _a.split('=')[1];
        if (!token) {
            res.status(401).json({ error: "Not authenticated" });
            return;
        }
        const user = yield (0, auth_service_1.getCurrentUser)(token);
        res.json({ user });
    }
    catch (error) {
        console.error("Session check error:", error);
        if (error.message === "User not found") {
            res.status(404).json({ error: error.message });
            return;
        }
        res.status(401).json({ error: "Not authenticated" });
    }
});
exports.getMe = getMe;
