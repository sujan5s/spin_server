import { Router } from 'express';
import { login, signup, googleLogin, getMe } from '../controllers/auth.controller';
import { sendOtp } from '../controllers/otp.controller';

const router = Router();

router.post('/login', login);
router.post('/signup', signup);
router.post('/google', googleLogin);
router.get('/me', getMe);
router.post('/otp/send', sendOtp);

export default router;
