const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth');
const { checkAiLimit } = require('../middlewares/aiLimit');
const {
  createDeck,
  getDecks,
  getDeckById,
  generateAiFlashcards,
  reviewFlashcard,
  updateDeck,
  deleteDeck,
  createCard,
  createBulkCards,
  updateCard,
  deleteCard,
  deleteBulkCards,
  createQuizFromDeck,
  importDeck
} = require('../controllers/flashcardController');

/**
 * @swagger
 * tags:
 *   name: Flashcards
 *   description: Flashcard deck creation, AI generation, and review
 */

router.use(requireAuth);

/**
 * @swagger
 * /api/flashcards:
 *   get:
 *     summary: Get all flashcard decks
 *     tags: [Flashcards]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of flashcard decks
 *   post:
 *     summary: Create a new flashcard deck
 *     tags: [Flashcards]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Deck created
 */
router.post('/', createDeck);
router.get('/', getDecks);

/**
 * @swagger
 * /api/flashcards/generate:
 *   post:
 *     summary: Generate flashcards with AI from document
 *     tags: [Flashcards]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Flashcards generated
 */
router.post('/generate', checkAiLimit, generateAiFlashcards);
router.post('/review', reviewFlashcard);

/**
 * @swagger
 * /api/flashcards/{id}:
 *   get:
 *     summary: Get flashcard deck details
 *     tags: [Flashcards]
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
 *         description: Deck details
 *   delete:
 *     summary: Delete flashcard deck
 *     tags: [Flashcards]
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
 *         description: Deck deleted
 */
router.get('/:id', getDeckById);
router.put('/:id', updateDeck);
router.delete('/:id', deleteDeck);
router.post('/:id/quiz', createQuizFromDeck);
router.post('/:id/import', importDeck);

// Individual card CRUD endpoints
router.post('/:deckId/cards', createCard);
router.post('/:deckId/cards/bulk', createBulkCards);
router.put('/cards/:cardId', updateCard);
router.post('/cards/bulk-delete', deleteBulkCards);
router.delete('/cards/bulk', deleteBulkCards);
router.delete('/cards/:cardId', deleteCard);

module.exports = router;
