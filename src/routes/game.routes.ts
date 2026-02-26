import { Router } from 'express';
import { slotsSpin } from '../controllers/game.controller';

const router = Router();

router.post('/slots/spin', slotsSpin);
// Add more games as needed

export default router;
