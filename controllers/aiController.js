const supabase = require('../config/supabaseClient');
const { summarizeDocument, answerQuestion } = require('../services/aiService');

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

module.exports = { triggerSummarize, triggerQnA, triggerChat };
