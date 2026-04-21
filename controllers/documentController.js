const supabase = require('../config/supabaseClient');
const { extractTextFromFile } = require('../services/fileExtractionService');
const { extractMetadata, summarizeDocument } = require('../services/aiService');
const { createEmbedding, cosineSimilarity } = require('../services/embeddingService');
const path = require('path');
const fs = require('fs');

const uploadDocument = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const filePath = req.file.path;
    const fileUrl = `/uploads/${req.file.filename}`;
    
    let originalName = req.file.originalname;
    try {
      const fixedName = Buffer.from(originalName, 'latin1').toString('utf8');
      if (!fixedName.includes('\uFFFD')) {
        originalName = fixedName;
      }
    } catch (e) {}
    
    // 1. Extract content OCR
    const content = await extractTextFromFile(filePath, req.file.mimetype);

    // 2. AI Metadata
    const metadata = await extractMetadata(content);

    // 3. Document Embeddings
    // Supabase pgvector uses string representation of arrays like '[1.2, 0.5, ...]'
    const rawEmbedding = await createEmbedding(content);
    const embedding = JSON.stringify(rawEmbedding);

    // 4. Save to DB
    const { data: doc, error } = await supabase
      .from('documents')
      .insert([{
        title: originalName,
        content,
        tags: metadata.tags || [],
        subject: req.body.subject || metadata.subject || 'General',
        file_url: fileUrl,
        embedding: embedding,
        user_id: req.user.id
      }])
      .select()
      .single();

    if (error) throw error;
    
    // Add backward compatibility _id
    const responseDoc = { ...doc, _id: doc.id };

    // 5. Emit socket globally
    req.io.emit('document_created', responseDoc);

    res.status(201).json(responseDoc);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getDocuments = async (req, res) => {
  try {
    let query = supabase.from('documents').select('id, title, summary, tags, subject, file_url, user_id, is_deleted, created_at, ai_confidence').eq('is_deleted', false);
    
    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    }
    
    const { data: docs, error } = await query;
    if (error) throw error;
    
    const responseDocs = docs.map(d => ({ ...d, _id: d.id }));
    res.status(200).json(responseDocs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getDocumentById = async (req, res) => {
  try {
    const { data: doc, error } = await supabase.from('documents').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (doc.is_deleted) return res.status(404).json({ error: 'Deleted' });
    
    if (req.user.role !== 'admin' && doc.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden' });
    }
    
    res.status(200).json({ ...doc, _id: doc.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateDocument = async (req, res) => {
  try {
    const { data: docCheck, error: checkErr } = await supabase.from('documents').select('id, user_id, is_deleted').eq('id', req.params.id).single();
    if (checkErr || !docCheck || docCheck.is_deleted) return res.status(404).json({ error: 'Not found' });
    
    if (req.user.role !== 'admin' && docCheck.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const { data: doc, error } = await supabase
      .from('documents')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();
      
    if (error) throw error;
    
    const responseDoc = { ...doc, _id: doc.id };
    req.io.emit('document_updated', responseDoc);
    res.status(200).json(responseDoc);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteDocument = async (req, res) => {
  try {
    const { data: docCheck, error: checkErr } = await supabase.from('documents').select('id, user_id').eq('id', req.params.id).single();
    if (checkErr || !docCheck) return res.status(404).json({ error: 'Not found' });
    
    if (req.user.role !== 'admin' && docCheck.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const { error } = await supabase.from('documents').delete().eq('id', req.params.id);
    if (error) throw error;
    
    req.io.emit('document_deleted', { _id: req.params.id });
    res.status(200).json({ message: 'Permanently deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getDashboardStats = async (req, res) => {
  try {
    let query = supabase.from('documents').select('id, title, created_at, subject, ai_confidence, summary').eq('is_deleted', false);
    
    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    }
    
    const { data: allUserDocs, error } = await query;
    if (error) throw error;
    
    const totalDocs = allUserDocs.length;
    const processedDocs = allUserDocs.filter(d => d.summary && d.summary.trim() !== '').length;
    const pendingDocs = totalDocs - processedDocs;
    
    let totalConfidence = 0;
    const subjectMap = {};
    
    allUserDocs.forEach(doc => {
       totalConfidence += (doc.ai_confidence || 95);
       const sub = doc.subject || 'Khác';
       subjectMap[sub] = (subjectMap[sub] || 0) + 1;
    });
    
    const avgConfidence = totalDocs > 0 ? Math.round(totalConfidence / totalDocs) : 0;
    const subjectStats = Object.keys(subjectMap)
      .map(sub => ({ subject: sub, count: subjectMap[sub] }))
      .sort((a,b) => b.count - a.count);
    
    // Sort array in memory for recentDocs since we just fetched all
    const recentDocs = [...allUserDocs]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5)
      .map(d => ({ title: d.title, created_at: d.created_at, subject: d.subject, aiConfidence: d.ai_confidence, id: d.id, _id: d.id }));

    res.status(200).json({
      totalDocs,
      processedDocs,
      pendingDocs,
      avgConfidence,
      subjectStats,
      recentDocs
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  uploadDocument,
  getDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
  getDashboardStats
};
