import { Router } from 'express';
import { deposit, withdraw, getTransactions } from '../controllers/wallet.controller';

const router = Router();

router.post('/deposit', deposit);
router.post('/withdraw', withdraw);
router.get('/transactions', getTransactions);

export default router;
