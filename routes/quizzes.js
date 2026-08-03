const express = require('express');
const {
  getQuizzes,
  getQuizById,
  getAttempts,
  startAttempt,
  updateProgress,
  submitAttempt,
  getAttemptById,
  getQuizAttemptsForAdmin,
  deleteQuiz,
  deleteAttempt
} = require('../controllers/quizController');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Quizzes
 *   description: Quiz generation, attempts, and scoring
 */

// Require authentication for all quiz routes
router.use(requireAuth);

/**
 * @swagger
 * /api/quizzes:
 *   get:
 *     summary: Get all quizzes for current user
 *     tags: [Quizzes]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of quizzes
 */
router.get('/', getQuizzes);

/**
 * @swagger
 * /api/quizzes/attempts:
 *   get:
 *     summary: Get all quiz attempt histories
 *     tags: [Quizzes]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of quiz attempts
 */
router.get('/attempts', getAttempts);

// Specific attempt routes
router.put('/attempts/:attemptId/progress', updateProgress);
router.post('/attempts/:attemptId/submit', submitAttempt);
router.get('/attempts/:attemptId', getAttemptById);
router.delete('/attempts/:attemptId', deleteAttempt);

/**
 * @swagger
 * /api/quizzes/{id}:
 *   get:
 *     summary: Get quiz by ID
 *     tags: [Quizzes]
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
 *         description: Quiz details
 *   delete:
 *     summary: Delete quiz by ID
 *     tags: [Quizzes]
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
 *         description: Quiz deleted
 */
router.get('/:id/attempts/admin', getQuizAttemptsForAdmin);
router.post('/:id/attempts', startAttempt);
router.get('/:id', getQuizById);
router.delete('/:id', deleteQuiz);

// Export quizzes router
module.exports = router;
