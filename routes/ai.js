const express = require('express');
const { triggerSummarize, triggerQnA, triggerChat } = require('../controllers/aiController');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

router.use(requireAuth);

router.post('/summarize', triggerSummarize);
router.post('/qna', triggerQnA);
router.post('/chat', triggerChat);

module.exports = router;
