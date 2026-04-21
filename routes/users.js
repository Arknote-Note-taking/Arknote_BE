const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth');
const upload = require('../config/multerConfig');
const { getUsers, deleteUser, getProfile, updateProfile, uploadAvatar } = require('../controllers/userController');

// All user routes require authentication
router.use(requireAuth);

// Profile & Avatar routes (everyone)
router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.post('/avatar', upload.single('avatar'), uploadAvatar);

// Admin only routes
router.get('/', getUsers);
router.delete('/:id', deleteUser);

module.exports = router;
