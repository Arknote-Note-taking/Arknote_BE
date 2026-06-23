const express = require('express');
const { 
  triggerSummarize, triggerQnA, triggerChat, triggerReanalyze, triggerFolderChat, triggerQuiz,
  getChatHistories, createChatHistory, updateChatHistory, deleteChatHistory 
} = require('../controllers/aiController');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

router.use(requireAuth);

router.post('/summarize', triggerSummarize);
router.post('/qna', triggerQnA);
router.post('/chat', triggerChat);
router.post('/reanalyze', triggerReanalyze);
router.post('/folder-chat', triggerFolderChat);
router.post('/quiz', triggerQuiz);

// Chat histories CRUD
router.get('/chats', getChatHistories);
router.post('/chats', createChatHistory);
router.put('/chats/:id', updateChatHistory);
router.delete('/chats/:id', deleteChatHistory);

module.exports = router;
