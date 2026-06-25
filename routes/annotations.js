const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth');
const {
  createAnnotation,
  getAnnotations,
  deleteAnnotation
} = require('../controllers/annotationController');

router.use(requireAuth);

router.post('/documents/:documentId', createAnnotation);
router.get('/documents/:documentId', getAnnotations);
router.delete('/:id', deleteAnnotation);

module.exports = router;
