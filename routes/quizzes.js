const express = require('express');
const {
  getQuizzes,
  getQuizById,
  getAttempts,
  startAttempt,
  updateProgress,
  submitAttempt,
  getAttemptById,
  getQuizAttemptsForAdmin
} = require('../controllers/quizController');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

// Require authentication for all quiz routes
router.use(requireAuth);

// Routes
router.get('/', getQuizzes);
router.get('/attempts', getAttempts);

// Specific attempt routes
router.put('/attempts/:attemptId/progress', updateProgress);
router.post('/attempts/:attemptId/submit', submitAttempt);
router.get('/attempts/:attemptId', getAttemptById);

// Quiz-specific routes (parameterized with :id)
router.get('/:id/attempts/admin', getQuizAttemptsForAdmin);
router.post('/:id/attempts', startAttempt);
router.get('/:id', getQuizById);

module.exports = router;
