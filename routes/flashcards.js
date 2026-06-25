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
  updateCard,
  deleteCard,
  createQuizFromDeck
} = require('../controllers/flashcardController');

router.use(requireAuth);

router.post('/', createDeck);
router.get('/', getDecks);
router.get('/:id', getDeckById);
router.put('/:id', updateDeck);
router.delete('/:id', deleteDeck);
router.post('/:id/quiz', createQuizFromDeck);

// Individual card CRUD endpoints
router.post('/:deckId/cards', createCard);
router.put('/cards/:cardId', updateCard);
router.delete('/cards/:cardId', deleteCard);

router.post('/generate', checkAiLimit, generateAiFlashcards);
router.post('/review', reviewFlashcard);

module.exports = router;
