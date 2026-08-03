const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth');
const {
  getNotifications,
  markAllAsRead,
  markAsRead,
  deleteNotification,
  clearNotifications
} = require('../controllers/notificationController');

/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: In-app user notifications
 */

router.use(requireAuth);

/**
 * @swagger
 * /api/notifications:
 *   get:
 *     summary: Get all user notifications
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of notifications
 *   delete:
 *     summary: Clear all notifications
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notifications cleared
 */
router.get('/', getNotifications);
router.post('/read-all', markAllAsRead);
router.post('/:id/read', markAsRead);
router.delete('/', clearNotifications);
router.delete('/:id', deleteNotification);

module.exports = router;
