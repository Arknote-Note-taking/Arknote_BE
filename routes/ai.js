const express = require('express');
const { 
  triggerSummarize, triggerQnA, triggerChat, triggerReanalyze, triggerFolderChat, triggerQuiz,
  getChatHistories, createChatHistory, updateChatHistory, deleteChatHistory 
} = require('../controllers/aiController');
const { requireAuth } = require('../middlewares/auth');
const { checkAiLimit } = require('../middlewares/aiLimit');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: AI
 *   description: AI Summarization, Q&A, Chat, and Quiz generation
 */

router.use(requireAuth);

/**
 * @swagger
 * /api/ai/summarize:
 *   post:
 *     summary: Generate summary for a document
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - documentId
 *             properties:
 *               documentId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Summary generated
 */
router.post('/summarize', checkAiLimit, triggerSummarize);

/**
 * @swagger
 * /api/ai/qna:
 *   post:
 *     summary: Ask a question about a document
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - documentId
 *               - question
 *             properties:
 *               documentId:
 *                 type: string
 *               question:
 *                 type: string
 *     responses:
 *       200:
 *         description: Answer returned
 */
router.post('/qna', checkAiLimit, triggerQnA);

/**
 * @swagger
 * /api/ai/chat:
 *   post:
 *     summary: Chat with AI assistant
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: AI Chat response
 */
router.post('/chat', checkAiLimit, triggerChat);
router.post('/reanalyze', checkAiLimit, triggerReanalyze);
router.post('/folder-chat', checkAiLimit, triggerFolderChat);
router.post('/quiz', checkAiLimit, triggerQuiz);

/**
 * @swagger
 * /api/ai/chats:
 *   get:
 *     summary: Get AI chat history
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of chat history sessions
 *   post:
 *     summary: Create new chat history session
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Chat history session created
 */
router.get('/chats', getChatHistories);
router.post('/chats', createChatHistory);

/**
 * @swagger
 * /api/ai/chats/{id}:
 *   put:
 *     summary: Update chat history session
 *     tags: [AI]
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
 *         description: Chat updated
 *   delete:
 *     summary: Delete chat history session
 *     tags: [AI]
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
 *         description: Chat deleted
 */
router.put('/chats/:id', updateChatHistory);
router.delete('/chats/:id', deleteChatHistory);

module.exports = router;
