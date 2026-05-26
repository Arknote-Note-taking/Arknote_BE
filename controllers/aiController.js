const supabase = require('../config/supabaseClient');
const { summarizeDocument, answerQuestion, extractMetadata } = require('../services/aiService');

const triggerSummarize = async (req, res) => {
  try {
    const { data: doc, error: err1 } = await supabase.from('documents').select('*').eq('id', req.body.documentId).single();
    if (err1 || !doc || doc.is_deleted) return res.status(404).json({ error: 'Document not found' });
    
    if (req.user.role !== 'admin' && doc.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    if (doc.summary) {
      return res.status(200).json({ summary: doc.summary }); // already summarized
    }

    const summary = await summarizeDocument(doc.content);
    
    const { data: updatedDoc, error: err2 } = await supabase
      .from('documents')
      .update({ summary })
      .eq('id', doc.id)
      .select()
      .single();
      
    if (err2) throw err2;

    req.io.emit('document_updated', { ...updatedDoc, _id: updatedDoc.id });
    res.status(200).json({ summary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const triggerQnA = async (req, res) => {
  try {
    const { documentId, question } = req.body;
    const { data: doc, error: err1 } = await supabase.from('documents').select('id, user_id, is_deleted, content').eq('id', documentId).single();
    if (err1 || !doc || doc.is_deleted) return res.status(404).json({ error: 'Document not found' });
    
    if (req.user.role !== 'admin' && doc.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const answer = await answerQuestion(doc.content, question);
    res.status(200).json({ answer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const triggerChat = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message cannot be empty' });
    
    // In a real scenario, you'd feed this message + history to OpenAI.
    // For now, we mock the delay and response.
    const mockResponse = `Tôi đã nhận được yêu cầu "${message}".\nHệ thống đang lọc các tài liệu có liên đới thuộc cơ sở dữ liệu của bạn, bao gồm các chính sách Nhân sự và Luật pháp.\n\nCó tài liệu nào cụ thể mảng này bạn muốn tôi đào sâu không?`;
    
    setTimeout(() => {
      res.status(200).json({ answer: mockResponse });
    }, 1500); // Simulate API latency
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const triggerReanalyze = async (req, res) => {
  try {
    const { documentId } = req.body;
    const { data: doc, error: err1 } = await supabase.from('documents').select('*').eq('id', documentId).single();
    if (err1 || !doc || doc.is_deleted) return res.status(404).json({ error: 'Document not found' });
    
    if (req.user.role !== 'admin' && doc.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const metadata = await extractMetadata(doc.content);
    const summary = await summarizeDocument(doc.content);

    res.status(200).json({
      title: metadata.title || doc.title,
      subject: metadata.subject || doc.subject,
      summary: summary || doc.summary
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const triggerFolderChat = async (req, res) => {
  try {
    const { folderId, question } = req.body;
    if (!folderId) return res.status(400).json({ error: 'Folder ID is required' });
    if (!question) return res.status(400).json({ error: 'Question is required' });

    // 1. Check folder
    const { data: folder, error: folderErr } = await supabase
      .from('folders')
      .select('*')
      .eq('id', folderId)
      .single();

    if (folderErr || !folder) return res.status(404).json({ error: 'Folder not found' });
    if (folder.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    // 2. Fetch all documents in folder
    const { data: docs, error: docsErr } = await supabase
      .from('documents')
      .select('title, content')
      .eq('folder_id', folderId)
      .eq('is_deleted', false);

    if (docsErr) throw docsErr;
    if (!docs || docs.length === 0) {
      return res.status(200).json({ answer: 'Không tìm thấy tài liệu nào trong thư mục này để phân tích.' });
    }

    // 3. Concatenate content
    let aggregatedContext = '';
    docs.forEach((doc, idx) => {
      aggregatedContext += `--- Tài liệu ${idx + 1}: ${doc.title} ---\nNội dung:\n${doc.content || ''}\n\n`;
    });

    // 4. Call answerQuestion
    const answer = await answerQuestion(aggregatedContext, question);
    res.status(200).json({ answer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { triggerSummarize, triggerQnA, triggerChat, triggerReanalyze, triggerFolderChat };
