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

    // Enforce dynamic file size check based on user plan
    const userPro = await isUserPro(req.user.id);
    const sizeLimit = userPro || req.user.role === 'admin' ? 100 * 1024 * 1024 : 5 * 1024 * 1024; // 100MB vs 5MB
    if (req.file.size > sizeLimit) {
      if (req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ 
        error: `Kích thước tệp quá lớn (${(req.file.size / 1024 / 1024).toFixed(1)}MB). Giới hạn tệp tối đa của bạn là ${userPro || req.user.role === 'admin' ? '100MB' : '5MB'}. Vui lòng ${userPro || req.user.role === 'admin' ? 'nén tệp nhỏ hơn' : 'nâng cấp tài khoản PRO để tải lên tệp tối đa 100MB'}!` 
      });
    }

    // Limit check for non-pro users
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

    // Determine temporary subject if 'Auto' is selected
    let subjectVal = req.body.subject;
    if (!subjectVal || subjectVal.trim().toLowerCase() === 'auto') {
      subjectVal = 'Đang phân tích...';
    }
    const normalizedSub = subjectVal.trim().toLowerCase();
    if (normalizedSub === 'general' || normalizedSub === 'unknown' || !subjectVal.trim()) {
      subjectVal = 'Khác';
    }

    // 2. Save document to DB immediately (without waiting for AI)
    const { data: doc, error } = await supabase
      .from('documents')
      .insert([{
        title: originalName,
        content,
        tags: ['Đang phân tích...'],
        subject: subjectVal,
        file_url: fileUrl,
        embedding: null,
        summary: 'Đang tóm tắt bằng AI...',
        user_id: req.user.id,
        folder_id: req.body.folder_id || null
      }])
      .select()
      .single();

    if (error) throw error;
    
    // Add backward compatibility _id
    const responseDoc = { ...doc, _id: doc.id };

    // 3. Emit socket for document creation and respond 201 immediately
    req.io.emit('document_created', responseDoc);
    res.status(201).json(responseDoc);

    // 4. Run AI processing in the background asynchronously
    (async () => {
      try {
        console.log(`[AI-Background] Starting metadata & embedding extraction for document: ${doc.id}`);
        
        const isPro = userPro || req.user.role === 'admin';
        // Execute Gemini metadata extraction & Embedding creation in parallel
        const [metadata, rawEmbedding] = await Promise.all([
          extractMetadata(content, isPro),
          createEmbedding(content)
        ]);

        const summaryVal = metadata.summary || 'Không có bản tóm tắt.';
        const embeddingVal = JSON.stringify(rawEmbedding);
        const tagsVal = metadata.tags || [];

        // Finalize subject if it was set to 'Auto'
        let finalSubject = req.body.subject;
        if (!finalSubject || finalSubject.trim().toLowerCase() === 'auto') {
          finalSubject = metadata.subject || 'Khác';
        }
        const normalizedFinalSub = finalSubject.trim().toLowerCase();
        if (normalizedFinalSub === 'auto' || normalizedFinalSub === 'general' || normalizedFinalSub === 'unknown' || !finalSubject.trim()) {
          finalSubject = 'Khác';
        }

        // Update document with AI details in Supabase
        const { data: updatedDoc, error: updateErr } = await supabase
          .from('documents')
          .update({
            tags: tagsVal,
            subject: finalSubject,
            embedding: embeddingVal,
            summary: summaryVal
          })
          .eq('id', doc.id)
          .select()
          .single();

        if (updateErr) throw updateErr;

        console.log(`[AI-Background] Successfully completed AI processing for document: ${doc.id}`);

        // Emit document_updated event to all clients to refresh UI in real-time
        const responseUpdatedDoc = { ...updatedDoc, _id: updatedDoc.id };
        req.io.emit('document_updated', responseUpdatedDoc);
      } catch (bgError) {
        console.error(`[AI-Background] Error in background AI processing for ${doc.id}:`, bgError);
        
        // Gracefully set tags/summary to indicate failure instead of keeping loading state
        try {
          const { data: failedDoc } = await supabase
            .from('documents')
            .update({
              tags: ['Thất bại'],
              summary: 'Không thể tóm tắt tài liệu do sự cố kết nối AI.',
              subject: req.body.subject && req.body.subject.trim().toLowerCase() !== 'auto' ? req.body.subject : 'Khác'
            })
            .eq('id', doc.id)
            .select()
            .single();

          if (failedDoc) {
            req.io.emit('document_updated', { ...failedDoc, _id: failedDoc.id });
          }
        } catch (dbErr) {
          console.error('[AI-Background] Failed to write fallback state to DB:', dbErr);
        }
      }
    })();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getDocuments = async (req, res) => {
  try {
    let sharedFolderIds = [];
    if (req.user.role !== 'admin') {
      const { data: shares } = await supabase
        .from('folder_shares')
        .select('folder_id')
        .eq('shared_to_email', req.user.email);
      if (shares && shares.length > 0) {
        sharedFolderIds = shares.map(s => s.folder_id).filter(id => id !== null);
      }
    }

    let query = supabase.from('documents').select('id, title, summary, tags, subject, file_url, user_id, is_deleted, created_at, ai_confidence, is_pinned, folder_id').eq('is_deleted', false);
    
    if (req.user.role !== 'admin') {
      if (sharedFolderIds.length > 0) {
        query = query.or(`user_id.eq.${req.user.id},folder_id.in.(${sharedFolderIds.map(id => `"${id}"`).join(',')})`);
      } else {
        query = query.eq('user_id', req.user.id);
      }
    }
    
    const { data: docs, error } = await query;
    if (error) throw error;
    
    let responseDocs = docs.map(d => ({ ...d, _id: d.id }));

    // If admin, filter out duplicates by title
    if (req.user.role === 'admin') {
      const uniqueDocs = [];
      const seenTitles = new Set();
      responseDocs.forEach(doc => {
        const normalizedTitle = doc.title?.toLowerCase().trim();
        if (!seenTitles.has(normalizedTitle)) {
          seenTitles.add(normalizedTitle);
          uniqueDocs.push(doc);
        }
      });
      responseDocs = uniqueDocs;
    }

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
    
    if (req.user.role === 'admin') {
      return res.status(403).json({ error: 'Admin chỉ quản lý tài liệu, không thể xem chi tiết nội dung tài liệu.' });
    }
    
    let hasAccess = false;
    if (doc.user_id === req.user.id) {
      hasAccess = true;
    } else if (doc.folder_id) {
      const { data: share } = await supabase
        .from('folder_shares')
        .select('*')
        .eq('folder_id', doc.folder_id)
        .eq('shared_to_email', req.user.email)
        .maybeSingle();
      if (share) hasAccess = true;
    }

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access forbidden' });
    }
    
    res.status(200).json({ ...doc, _id: doc.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateDocument = async (req, res) => {
  try {
    const { data: docCheck, error: checkErr } = await supabase.from('documents').select('id, user_id, is_deleted, folder_id').eq('id', req.params.id).single();
    if (checkErr || !docCheck || docCheck.is_deleted) return res.status(404).json({ error: 'Not found' });
    
    let canUpdate = false;
    if (docCheck.user_id === req.user.id || req.user.role === 'admin') {
      canUpdate = true;
    } else if (docCheck.folder_id) {
      const { data: share } = await supabase
        .from('folder_shares')
        .select('*')
        .eq('folder_id', docCheck.folder_id)
        .eq('shared_to_email', req.user.email)
        .eq('permission_role', 'editor')
        .maybeSingle();
      if (share) canUpdate = true;
    }

    if (!canUpdate) {
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
    let query = supabase
      .from('documents')
      .select('id, title, summary, tags, subject, file_url, user_id, created_at')
      .eq('is_deleted', true);

    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    }

    const { data: docs, error } = await query;
    if (error) throw error;
    
    const { data: users, error: userErr } = await supabase.from('users').select('id, email');
    const userMap = {};
    if (!userErr && users) {
      users.forEach(u => { userMap[u.id] = u.email; });
    }
    
    let formatted = docs.map(d => ({ 
      ...d, 
      _id: d.id,
      user_email: userMap[d.user_id] || 'Unknown' 
    }));

    // Filter out duplicates by title
    const uniqueDocs = [];
    const seenTitles = new Set();
    formatted.forEach(doc => {
      const normalizedTitle = doc.title?.toLowerCase().trim();
      if (!seenTitles.has(normalizedTitle)) {
        seenTitles.add(normalizedTitle);
        uniqueDocs.push(doc);
      }
    });
    formatted = uniqueDocs;

    res.status(200).json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const restoreDocument = async (req, res) => {
  try {
    console.log('[Restore-Debug] restoreDocument hit. User:', req.user?.email, 'Role:', req.user?.role);
    if (req.user.role !== 'admin') {
      console.log('[Restore-Debug] Access forbidden: User role is not admin');
      return res.status(403).json({ error: 'Access forbidden' });
    }
    // Retrieve doc to get title and owner user_id
    const { data: docToCheck, error: checkError } = await supabase
      .from('documents')
      .select('id, title, user_id')
      .eq('id', req.params.id)
      .single();

    if (checkError || !docToCheck) {
      return res.status(404).json({ error: 'Không tìm thấy tài liệu.' });
    }

    // Check if there is an active document with the same title for the user
    const { data: activeDocs, error: activeError } = await supabase
      .from('documents')
      .select('id')
      .eq('user_id', docToCheck.user_id)
      .eq('is_deleted', false)
      .eq('title', docToCheck.title);

    if (activeError) throw activeError;
    if (activeDocs && activeDocs.length > 0) {
      return res.status(400).json({ error: `Tài liệu "${docToCheck.title}" đã tồn tại trong danh sách tài liệu hoạt động của người dùng.` });
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

    // Save & Emit notification to user that their document has been restored
    const { createNotification } = require('../services/notificationService');
    await createNotification(req, {
      recipientId: doc.user_id,
      type: 'document_restored',
      title: 'Tài liệu đã được khôi phục',
      message: `Tài liệu "${doc.title}" của bạn đã được Admin khôi phục thành công!`,
      docId: doc.id
    });

    res.status(200).json(responseDoc);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const requestRestoreDocument = async (req, res) => {
  try {
    console.log('[Socket-Debug] requestRestoreDocument called for ID:', req.params.id);
    const { data: doc, error } = await supabase
      .from('documents')
      .select('id, title, user_id')
      .eq('id', req.params.id)
      .single();
      
    if (error || !doc) {
      console.error('[Socket-Debug] Document not found:', error);
      return res.status(404).json({ error: 'Không tìm thấy tài liệu.' });
    }

    // Check if there is an active document with the same title for the user
    const { data: activeDocs, error: activeError } = await supabase
      .from('documents')
      .select('id')
      .eq('user_id', doc.user_id)
      .eq('is_deleted', false)
      .eq('title', doc.title);

    if (activeError) throw activeError;
    if (activeDocs && activeDocs.length > 0) {
      return res.status(400).json({ error: `Tài liệu "${doc.title}" đã tồn tại trong tài liệu hiện tại của bạn. Không cần khôi phục!` });
    }

    // Save & Emit notification to admin
    console.log('[Socket-Debug] Emitting admin_notification for:', doc.title, 'from user:', req.user.email);
    const { createNotification } = require('../services/notificationService');
    await createNotification(req, {
      isForAdmin: true,
      type: 'document_restore_request',
      title: 'Yêu cầu khôi phục tài liệu',
      message: `Tài liệu: ${doc.title} (Yêu cầu từ: ${req.user.email})`,
      docId: doc.id
    });
    
    res.status(200).json({ message: 'Đã gửi yêu cầu khôi phục tài liệu tới Admin.' });
  } catch (error) {
    console.error('[Socket-Debug] requestRestoreDocument Exception:', error);
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
  restoreDocument,
  requestRestoreDocument
};
