const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth');
const {
  shareFolder,
  getFolderShares,
  deleteFolderShare,
  getSharedFolders,
  addDocumentComment,
  getDocumentComments,
  updateFolderShare
} = require('../controllers/shareController');

/**
 * @swagger
 * tags:
 *   name: Shares
 *   description: Folder sharing and document comment endpoints
 */

router.use(requireAuth);

/**
 * @swagger
 * /api/shares/folders/share:
 *   post:
 *     summary: Share a folder with another user
 *     tags: [Shares]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Folder shared
 */
router.post('/folders/share', shareFolder);
router.get('/folders/:folderId/shares', getFolderShares);
router.put('/folders/shares/:id', updateFolderShare);
router.delete('/folders/shares/:id', deleteFolderShare);

/**
 * @swagger
 * /api/shares/shared-folders:
 *   get:
 *     summary: Get folders shared with me
 *     tags: [Shares]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of shared folders
 */
router.get('/shared-folders', getSharedFolders);
router.post('/documents/comments', addDocumentComment);
router.get('/documents/:documentId/comments', getDocumentComments);

module.exports = router;
