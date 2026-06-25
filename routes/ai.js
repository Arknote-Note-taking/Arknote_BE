const express = require('express');
const { 
  triggerSummarize, triggerQnA, triggerChat, triggerReanalyze, triggerFolderChat, triggerQuiz,
  getChatHistories, createChatHistory, updateChatHistory, deleteChatHistory 
} = require('../controllers/aiController');
const { requireAuth } = require('../middlewares/auth');
const { checkAiLimit } = require('../middlewares/aiLimit');

const router = express.Router();

router.use(requireAuth);

router.post('/summarize', checkAiLimit, triggerSummarize);
router.post('/qna', checkAiLimit, triggerQnA);
router.post('/chat', checkAiLimit, triggerChat);
router.post('/reanalyze', checkAiLimit, triggerReanalyze);
router.post('/folder-chat', checkAiLimit, triggerFolderChat);
router.post('/quiz', checkAiLimit, triggerQuiz);

// Chat histories CRUD
router.get('/chats', getChatHistories);
router.post('/chats', createChatHistory);
router.put('/chats/:id', updateChatHistory);
router.delete('/chats/:id', deleteChatHistory);

module.exports = router;
