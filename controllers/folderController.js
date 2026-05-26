const supabase = require('../config/supabaseClient');

const getFolders = async (req, res) => {
  try {
    // 1. Fetch folders
    const { data: folders, error: foldersErr } = await supabase
      .from('folders')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (foldersErr) throw foldersErr;

    // 2. Fetch document counts per folder
    const { data: docs, error: docsErr } = await supabase
      .from('documents')
      .select('id, folder_id')
      .eq('user_id', req.user.id)
      .eq('is_deleted', false);

    if (docsErr) throw docsErr;

    const countMap = {};
    docs.forEach(doc => {
      if (doc.folder_id) {
        countMap[doc.folder_id] = (countMap[doc.folder_id] || 0) + 1;
      }
    });

    const formatted = folders.map(f => ({
      ...f,
      _id: f.id,
      docCount: countMap[f.id] || 0
    }));

    res.status(200).json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createFolder = async (req, res) => {
  try {
    const { name, documentIds } = req.body;
    if (!name) return res.status(400).json({ error: 'Folder name is required' });

    // 1. Insert folder
    const { data: folder, error } = await supabase
      .from('folders')
      .insert([{ name, user_id: req.user.id }])
      .select()
      .single();

    if (error) throw error;

    // 2. Add documents if provided
    if (documentIds && Array.isArray(documentIds) && documentIds.length > 0) {
      const { error: updateErr } = await supabase
        .from('documents')
        .update({ folder_id: folder.id })
        .in('id', documentIds)
        .eq('user_id', req.user.id);
      if (updateErr) throw updateErr;
    }

    const response = { ...folder, _id: folder.id, docCount: documentIds?.length || 0 };
    res.status(201).json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getFolderById = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: folder, error: folderErr } = await supabase
      .from('folders')
      .select('*')
      .eq('id', id)
      .single();

    if (folderErr || !folder) return res.status(404).json({ error: 'Folder not found' });
    if (folder.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    // Get documents inside folder
    const { data: docs, error: docsErr } = await supabase
      .from('documents')
      .select('id, title, summary, tags, subject, file_url, created_at')
      .eq('folder_id', id)
      .eq('is_deleted', false);

    if (docsErr) throw docsErr;

    const formattedDocs = docs.map(d => ({ ...d, _id: d.id }));
    res.status(200).json({
      ...folder,
      _id: folder.id,
      documents: formattedDocs
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: folder, error: folderErr } = await supabase
      .from('folders')
      .select('*')
      .eq('id', id)
      .single();

    if (folderErr || !folder) return res.status(404).json({ error: 'Folder not found' });
    if (folder.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    // Set folder_id to null for all documents inside
    await supabase
      .from('documents')
      .update({ folder_id: null })
      .eq('folder_id', id);

    // Delete folder
    const { error: delErr } = await supabase
      .from('folders')
      .delete()
      .eq('id', id);

    if (delErr) throw delErr;

    res.status(200).json({ message: 'Folder deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const addDocsToFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const { documentIds } = req.body;
    if (!documentIds || !Array.isArray(documentIds)) {
      return res.status(400).json({ error: 'documentIds array is required' });
    }

    const { data: folder, error: folderErr } = await supabase
      .from('folders')
      .select('*')
      .eq('id', id)
      .single();

    if (folderErr || !folder) return res.status(404).json({ error: 'Folder not found' });
    if (folder.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const { error: updateErr } = await supabase
      .from('documents')
      .update({ folder_id: id })
      .in('id', documentIds)
      .eq('user_id', req.user.id);

    if (updateErr) throw updateErr;

    res.status(200).json({ message: 'Documents added to folder successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getFolders,
  createFolder,
  getFolderById,
  deleteFolder,
  addDocsToFolder
};
