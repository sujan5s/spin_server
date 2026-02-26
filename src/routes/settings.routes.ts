import { Router } from 'express';
import { updateProfile, updatePassword, deleteAccount } from '../controllers/settings.controller';

const router = Router();

router.put('/profile', updateProfile);
router.put('/password', updatePassword);
router.delete('/delete-account', deleteAccount);

export default router;
