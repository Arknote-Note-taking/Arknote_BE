const supabase = require('../config/supabaseClient');
const { extractTextFromFile } = require('../services/fileExtractionService');
const { extractMetadata, summarizeDocument } = require('../services/aiService');
const { createEmbedding, cosineSimilarity } = require('../services/embeddingService');
const { isUserPro } = require('./userController');
const path = require('path');
const fs = require('fs');

const uploadDocument = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Limit check for non-pro users
    const userPro = isUserPro(req.user.id);
    if (!userPro && req.user.role !== 'admin') {
      const { count, error: countErr } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', req.user.id)
        .eq('is_deleted', false);

      if (countErr) throw countErr;

      if (count >= 5) {
        // Delete uploaded temp file to avoid junk in uploads folder
        if (req.file.path && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(403).json({ error: 'Bạn đã đạt giới hạn tải lên tối đa là 5 tài liệu đối với tài khoản thường. Vui lòng nâng cấp Pro để tải lên không giới hạn!' });
      }
    }

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

    // 2. AI Metadata & Embeddings (run in parallel)
    const [metadata, rawEmbedding] = await Promise.all([
      extractMetadata(content),
      createEmbedding(content)
    ]);
    const summary = metadata.summary || '';
    const embedding = JSON.stringify(rawEmbedding);

    // Determine subject: if no subject is sent or is 'Auto', try AI. If AI fails, use 'Khác'
    let subjectVal = req.body.subject;
    if (!subjectVal || subjectVal.trim().toLowerCase() === 'auto') {
      subjectVal = metadata.subject || 'Khác';
    }
    const normalizedSub = subjectVal.trim().toLowerCase();
    if (normalizedSub === 'auto' || normalizedSub === 'general' || normalizedSub === 'unknown' || !subjectVal.trim()) {
      subjectVal = 'Khác';
    }

    // 4. Save to DB
    const { data: doc, error } = await supabase
      .from('documents')
      .insert([{
        title: originalName,
        content,
        tags: metadata.tags || [],
        subject: subjectVal,
        file_url: fileUrl,
        embedding: embedding,
        summary: summary || '',
        user_id: req.user.id,
        folder_id: req.body.folder_id || null
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

    const { error } = await supabase.from('documents').update({ is_deleted: true }).eq('id', req.params.id);
    if (error) throw error;
    
    req.io.emit('document_deleted', { id: req.params.id }); // Use standard id field
    res.status(200).json({ message: 'Soft deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getDeletedDocuments = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }
    const { data: docs, error } = await supabase
      .from('documents')
      .select('id, title, summary, tags, subject, file_url, user_id, created_at')
      .eq('is_deleted', true);
    if (error) throw error;
    
    const { data: users, error: userErr } = await supabase.from('users').select('id, email');
    const userMap = {};
    if (!userErr && users) {
      users.forEach(u => { userMap[u.id] = u.email; });
    }
    
    const formatted = docs.map(d => ({ 
      ...d, 
      _id: d.id,
      user_email: userMap[d.user_id] || 'Unknown' 
    }));
    res.status(200).json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const restoreDocument = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }
    const { data: doc, error } = await supabase
      .from('documents')
      .update({ is_deleted: false })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    
    const responseDoc = { ...doc, _id: doc.id };
    req.io.emit('document_created', responseDoc);
    res.status(200).json(responseDoc);
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
  getDashboardStats,
  getDeletedDocuments,
  restoreDocument
};
