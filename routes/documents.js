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
  restoreDocument,
  requestRestoreDocument
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

/**
 * @swagger
 * tags:
 *   - name: Documents
 *     description: Document upload, search, and management
 *   - name: Folders
 *     description: Folder organization endpoints
 */

// Apply auth middleware to all document routes
router.use(requireAuth);

/**
 * @swagger
 * /api/documents/folders:
 *   get:
 *     summary: Get all folders for current user
 *     tags: [Folders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of folders
 *   post:
 *     summary: Create a new folder
 *     tags: [Folders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: Folder created
 */
router.get('/folders', getFolders);
router.post('/folders', createFolder);

/**
 * @swagger
 * /api/documents/folders/clear-documents:
 *   post:
 *     summary: Clear documents from folder
 *     tags: [Folders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Documents removed from folder
 */
router.post('/folders/clear-documents', clearFoldersDocuments);

/**
 * @swagger
 * /api/documents/folders/{id}:
 *   get:
 *     summary: Get folder details by ID
 *     tags: [Folders]
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
 *         description: Folder details
 *   put:
 *     summary: Update folder details
 *     tags: [Folders]
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
 *         description: Folder updated
 *   delete:
 *     summary: Delete folder
 *     tags: [Folders]
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
 *         description: Folder deleted
 */
router.get('/folders/:id', getFolderById);
router.put('/folders/:id', updateFolder);
router.delete('/folders/:id', deleteFolder);

/**
 * @swagger
 * /api/documents/folders/{id}/add-documents:
 *   post:
 *     summary: Add documents to folder
 *     tags: [Folders]
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
 *         description: Documents added to folder
 */
router.post('/folders/:id/add-documents', addDocsToFolder);

/**
 * @swagger
 * /api/documents/deleted:
 *   get:
 *     summary: Get user deleted documents (Trash Bin)
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of soft-deleted documents
 */
router.get('/deleted', getDeletedDocuments);

/**
 * @swagger
 * /api/documents/{id}/restore:
 *   post:
 *     summary: Restore document from Trash Bin
 *     tags: [Documents]
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
 *         description: Document restored
 */
router.post('/:id/restore', restoreDocument);
router.post('/:id/request-restore', requestRestoreDocument);

/**
 * @swagger
 * /api/documents/search:
 *   get:
 *     summary: Search documents using text or filters
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search query keyword
 *     responses:
 *       200:
 *         description: Search results
 */
router.get('/search', searchDocuments);

/**
 * @swagger
 * /api/documents/graph:
 *   get:
 *     summary: Get Knowledge Graph data of user documents
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Knowledge Graph nodes and edges
 */
router.get('/graph', getKnowledgeGraph);

/**
 * @swagger
 * /api/documents/stats:
 *   get:
 *     summary: Get dashboard statistics
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User document statistics
 */
router.get('/stats', getDashboardStats);

/**
 * @swagger
 * /api/documents:
 *   get:
 *     summary: Get all user documents
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of documents
 *   post:
 *     summary: Upload a new document file (PDF, TXT, DOCX, Images)
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Document uploaded and processing started
 */
router.get('/', getDocuments);
router.post('/', upload.single('file'), uploadDocument);

/**
 * @swagger
 * /api/documents/{id}:
 *   get:
 *     summary: Get document by ID
 *     tags: [Documents]
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
 *         description: Document details
 *   put:
 *     summary: Update document metadata
 *     tags: [Documents]
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
 *         description: Document updated
 *   delete:
 *     summary: Move document to Trash Bin (Soft Delete)
 *     tags: [Documents]
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
 *         description: Document soft deleted
 */
router.get('/:id', getDocumentById);
router.put('/:id', updateDocument);
router.delete('/:id', deleteDocument);

/**
 * @swagger
 * /api/documents/{id}/related:
 *   get:
 *     summary: Get related documents for a given document
 *     tags: [Documents]
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
 *         description: List of related documents
 */
router.get('/:id/related', getRelatedDocuments);

module.exports = router;
