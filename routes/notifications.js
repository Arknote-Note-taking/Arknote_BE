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

router.use(requireAuth);

router.get('/', getNotifications);
router.post('/read-all', markAllAsRead);
router.post('/:id/read', markAsRead);
router.delete('/', clearNotifications);
router.delete('/:id', deleteNotification);

module.exports = router;
