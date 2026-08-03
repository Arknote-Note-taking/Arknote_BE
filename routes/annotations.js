const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth');
const {
  createAnnotation,
  getAnnotations,
  deleteAnnotation
} = require('../controllers/annotationController');

/**
 * @swagger
 * tags:
 *   name: Annotations
 *   description: Document notes, highlights, and annotations
 */

router.use(requireAuth);

/**
 * @swagger
 * /api/annotations/documents/{documentId}:
 *   get:
 *     summary: Get all annotations for a document
 *     tags: [Annotations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of annotations
 *   post:
 *     summary: Create an annotation on a document
 *     tags: [Annotations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Annotation created
 */
router.post('/documents/:documentId', createAnnotation);
router.get('/documents/:documentId', getAnnotations);

/**
 * @swagger
 * /api/annotations/{id}:
 *   delete:
 *     summary: Delete an annotation
 *     tags: [Annotations]
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
 *         description: Annotation deleted
 */
router.delete('/:id', deleteAnnotation);

module.exports = router;
