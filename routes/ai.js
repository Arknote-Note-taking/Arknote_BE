const express = require('express');
const { triggerSummarize, triggerQnA, triggerChat, triggerReanalyze, triggerFolderChat } = require('../controllers/aiController');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

router.use(requireAuth);

router.post('/summarize', triggerSummarize);
router.post('/qna', triggerQnA);
router.post('/chat', triggerChat);
router.post('/reanalyze', triggerReanalyze);
router.post('/folder-chat', triggerFolderChat);

module.exports = router;
