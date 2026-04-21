const express = require('express');
const router = express.Router();
const upload = require('../config/multerConfig');
const { requireAuth } = require('../middlewares/auth');

const {
  uploadDocument,
  getDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
  getDashboardStats
} = require('../controllers/documentController');
const { searchDocuments, getKnowledgeGraph, getRelatedDocuments } = require('../controllers/advancedController');

// Apply auth middleware to all document routes
router.use(requireAuth);

// Advanced features
router.get('/search', searchDocuments);
router.get('/graph', getKnowledgeGraph);

// Standard CRUD
router.get('/', getDocuments);
router.post('/', upload.single('file'), uploadDocument);

// Stats
router.get('/stats', getDashboardStats);

router.get('/:id', getDocumentById);
router.put('/:id', updateDocument);
router.delete('/:id', deleteDocument);

// Specific Advanced Tools
router.get('/:id/related', getRelatedDocuments);

module.exports = router;
