const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth');
const {
  shareFolder,
  getFolderShares,
  deleteFolderShare,
  getSharedFolders,
  addDocumentComment,
  getDocumentComments
} = require('../controllers/shareController');

router.use(requireAuth);

router.post('/folders/share', shareFolder);
router.get('/folders/:folderId/shares', getFolderShares);
router.delete('/folders/shares/:id', deleteFolderShare);
router.get('/shared-folders', getSharedFolders);
router.post('/documents/comments', addDocumentComment);
router.get('/documents/:documentId/comments', getDocumentComments);

module.exports = router;
