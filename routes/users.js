const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth');
const upload = require('../config/multerConfig');
const { getUsers, getDeletedUsers, restoreUser, deleteUser, permanentDeleteUser, getProfile, updateProfile, uploadAvatar, upgradeToPro, requestDeleteAccount, saveOnboardingSurvey, requestRestoreAccount } = require('../controllers/userController');

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: User profiles and management endpoints
 */

/**
 * @swagger
 * /api/users/request-restore:
 *   post:
 *     summary: Request account restoration (Public)
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Account restoration request received
 */
router.post('/request-restore', requestRestoreAccount);

// All user routes require authentication
router.use(requireAuth);

/**
 * @swagger
 * /api/users/profile:
 *   get:
 *     summary: Get user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile details
 *   put:
 *     summary: Update user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName:
 *                 type: string
 *               bio:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated
 */
router.get('/profile', getProfile);
router.put('/profile', updateProfile);

/**
 * @swagger
 * /api/users/avatar:
 *   post:
 *     summary: Upload user avatar image
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Avatar uploaded successfully
 */
router.post('/avatar', upload.single('avatar'), uploadAvatar);

/**
 * @swagger
 * /api/users/upgrade-pro:
 *   post:
 *     summary: Upgrade user account to PRO plan
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Account upgraded to PRO
 */
router.post('/upgrade-pro', upgradeToPro);

/**
 * @swagger
 * /api/users/request-delete:
 *   post:
 *     summary: Request account deletion (Soft Delete)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Account scheduled for deletion
 */
router.post('/request-delete', requestDeleteAccount);

/**
 * @swagger
 * /api/users/onboarding:
 *   post:
 *     summary: Save user onboarding survey answers
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Survey saved successfully
 */
router.post('/onboarding', saveOnboardingSurvey);

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get list of users (Admin)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of active users
 */
router.get('/', getUsers);

/**
 * @swagger
 * /api/users/deleted:
 *   get:
 *     summary: Get list of deleted users (Admin)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of deleted users
 */
router.get('/deleted', getDeletedUsers);

/**
 * @swagger
 * /api/users/{id}/restore:
 *   post:
 *     summary: Restore a deleted user account (Admin)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User restored
 */
router.post('/:id/restore', restoreUser);

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Soft delete user (Admin)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User deleted
 */
router.delete('/:id', deleteUser);

/**
 * @swagger
 * /api/users/{id}/permanent:
 *   delete:
 *     summary: Permanently delete user account (Admin)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User permanently deleted
 */
router.delete('/:id/permanent', permanentDeleteUser);

module.exports = router;
