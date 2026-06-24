const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth');
const upload = require('../config/multerConfig');
const { getUsers, getDeletedUsers, restoreUser, deleteUser, permanentDeleteUser, getProfile, updateProfile, uploadAvatar, upgradeToPro, requestDeleteAccount, saveOnboardingSurvey } = require('../controllers/userController');

// All user routes require authentication
router.use(requireAuth);

// Profile & Avatar routes (everyone)
router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.post('/avatar', upload.single('avatar'), uploadAvatar);
router.post('/upgrade-pro', upgradeToPro);
router.post('/request-delete', requestDeleteAccount);
router.post('/onboarding', saveOnboardingSurvey);

// Admin only routes
router.get('/', getUsers);
router.get('/deleted', getDeletedUsers);
router.post('/:id/restore', restoreUser);
router.delete('/:id', deleteUser);
router.delete('/:id/permanent', permanentDeleteUser);

module.exports = router;
