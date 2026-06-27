const supabase = require('../config/supabaseClient');

// 1. Create a highlight / annotation on a document
const createAnnotation = async (req, res) => {
  try {
    const { documentId } = req.params;
    const { selectedText, note, color, rangeStart, rangeEnd } = req.body;

    if (!selectedText) {
      return res.status(400).json({ error: 'Nội dung bôi đen (selectedText) là bắt buộc' });
    }

    // Verify document access
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id, user_id, folder_id')
      .eq('id', documentId)
      .single();

    if (docErr || !doc) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });

    let hasAccess = false;
    if (doc.user_id === req.user.id || req.user.role === 'admin') {
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

    const { data: annotation, error: insertErr } = await supabase
      .from('document_annotations')
      .insert([{
        document_id: documentId,
        user_id: req.user.id,
        selected_text: selectedText,
        note: note || '',
        color: color || '#ffeb3b',
        range_start: rangeStart !== undefined ? parseInt(rangeStart, 10) : null,
        range_end: rangeEnd !== undefined ? parseInt(rangeEnd, 10) : null
      }])
      .select()
      .single();

    if (insertErr) throw insertErr;

    res.status(201).json(annotation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 2. Get all annotations for a document
const getAnnotations = async (req, res) => {
  try {
    const { documentId } = req.params;

    // Verify document access
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id, user_id, folder_id')
      .eq('id', documentId)
      .single();

    if (docErr || !doc) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });

    let hasAccess = false;
    if (doc.user_id === req.user.id || req.user.role === 'admin') {
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

    const { data: annotations, error } = await supabase
      .from('document_annotations')
      .select('*')
      .eq('document_id', documentId)
      .eq('user_id', req.user.id) // Get current user's annotations (or comments from everyone, but annotations are usually personal)
      .order('created_at', { ascending: true });

    if (error) throw error;
    const filteredAnnotations = annotations.filter(ann => ann.selected_text !== '__PIN__');
    res.status(200).json(filteredAnnotations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 3. Delete an annotation
const deleteAnnotation = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: annotation, error: fetchErr } = await supabase
      .from('document_annotations')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !annotation) return res.status(404).json({ error: 'Không tìm thấy ghi chú highlight' });
    if (annotation.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const { error: deleteErr } = await supabase
      .from('document_annotations')
      .delete()
      .eq('id', id);

    if (deleteErr) throw deleteErr;

    res.status(200).json({ message: 'Đã xóa highlight thành công' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createAnnotation,
  getAnnotations,
  deleteAnnotation
};
