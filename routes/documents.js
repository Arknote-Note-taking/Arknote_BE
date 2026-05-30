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
  getDashboardStats,
  getDeletedDocuments,
  restoreDocument
} = require('../controllers/documentController');

const {
  getFolders,
  createFolder,
  getFolderById,
  deleteFolder,
  addDocsToFolder,
  updateFolder,
  clearFoldersDocuments
} = require('../controllers/folderController');

const { searchDocuments, getKnowledgeGraph, getRelatedDocuments } = require('../controllers/advancedController');

// Apply auth middleware to all document routes
router.use(requireAuth);

// Folder routes (must be placed before general parameterized document routes)
router.get('/folders', getFolders);
router.post('/folders', createFolder);
router.post('/folders/clear-documents', clearFoldersDocuments);
router.get('/folders/:id', getFolderById);
router.put('/folders/:id', updateFolder);
router.delete('/folders/:id', deleteFolder);
router.post('/folders/:id/add-documents', addDocsToFolder);

// Soft delete routes
router.get('/deleted', getDeletedDocuments);
router.post('/:id/restore', restoreDocument);

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
