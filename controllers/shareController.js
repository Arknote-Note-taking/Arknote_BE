const supabase = require('../config/supabaseClient');
const { createNotification } = require('../services/notificationService');

// 1. Share a folder with another user by email
const shareFolder = async (req, res) => {
  try {
    const { folderId, sharedToEmail, permissionRole } = req.body;
    if (!folderId || !sharedToEmail) {
      return res.status(400).json({ error: 'Mã thư mục và Email người nhận là bắt buộc' });
    }

    const role = permissionRole || 'viewer';
    if (!['viewer', 'editor'].includes(role)) {
      return res.status(400).json({ error: 'Quyền truy cập không hợp lệ (chỉ hỗ trợ viewer hoặc editor)' });
    }

    // Check if folder exists and current user owns it
    const { data: folder, error: folderErr } = await supabase
      .from('folders')
      .select('*')
      .eq('id', folderId)
      .single();

    if (folderErr || !folder) return res.status(404).json({ error: 'Không tìm thấy thư mục' });
    if (folder.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Bạn không có quyền chia sẻ thư mục này' });
    }

    // Insert folder share
    const { data: share, error: shareErr } = await supabase
      .from('folder_shares')
      .insert([{
        folder_id: folderId,
        shared_by: req.user.id,
        shared_to_email: sharedToEmail.trim().toLowerCase(),
        permission_role: role
      }])
      .select()
      .single();

    if (shareErr) {
      if (shareErr.code === '23505') { // Unique constraint violation
        return res.status(400).json({ error: 'Thư mục này đã được chia sẻ cho người dùng này trước đó' });
      }
      throw shareErr;
    }

    // Try to notify the shared user
    try {
      const { data: targetUser, error: targetUserErr } = await supabase
        .from('users')
        .select('id')
        .ilike('email', sharedToEmail.trim())
        .single();

      console.log('[ShareController] Target User search for', sharedToEmail, 'result:', targetUser, 'Error:', targetUserErr);

      if (targetUser) {
        await createNotification(req, {
          recipientId: targetUser.id,
          type: 'folder_shared',
          title: 'Thư mục học tập được chia sẻ',
          message: `Người dùng ${req.user.name || req.user.email} đã chia sẻ thư mục "${folder.name}" với bạn.`
        });
      }
    } catch (notifErr) {
      console.error('Error sending folder sharing notification:', notifErr);
    }

    res.status(201).json(share);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 2. List all shared folder records for a folder (For the owner to see who it is shared with)
const getFolderShares = async (req, res) => {
  try {
    const { folderId } = req.params;

    // Check ownership
    const { data: folder, error: folderErr } = await supabase
      .from('folders')
      .select('user_id')
      .eq('id', folderId)
      .single();

    if (folderErr || !folder) return res.status(404).json({ error: 'Folder not found' });
    if (folder.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const { data: shares, error } = await supabase
      .from('folder_shares')
      .select('*')
      .eq('folder_id', folderId);

    if (error) throw error;
    res.status(200).json(shares);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 3. Revoke/delete a folder share
const deleteFolderShare = async (req, res) => {
  try {
    const { id } = req.params; // Share ID

    const { data: share, error: shareErr } = await supabase
      .from('folder_shares')
      .select('*, folders(user_id, name)')
      .eq('id', id)
      .single();

    if (shareErr || !share) return res.status(404).json({ error: 'Không tìm thấy liên kết chia sẻ' });
    if (share.shared_by !== req.user.id && share.folders.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const { error: deleteErr } = await supabase
      .from('folder_shares')
      .delete()
      .eq('id', id);

    if (deleteErr) throw deleteErr;

    // Try to notify the shared user that access was revoked
    try {
      const { data: targetUser } = await supabase
        .from('users')
        .select('id')
        .ilike('email', share.shared_to_email)
        .single();

      if (targetUser) {
        await createNotification(req, {
          recipientId: targetUser.id,
          type: 'folder_unshared',
          title: 'Thu hồi quyền truy cập thư mục',
          message: `Người dùng ${req.user.name || req.user.email} đã thu hồi quyền chia sẻ thư mục "${share.folders?.name || 'thư mục'}" của bạn.`
        });
      }
    } catch (notifErr) {
      console.error('Error sending folder unshare notification:', notifErr);
    }

    res.status(200).json({ message: 'Đã hủy quyền chia sẻ thư mục thành công' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 4. Get list of folders shared WITH the current user
const getSharedFolders = async (req, res) => {
  try {
    // Query folder shares matching user email
    const { data: shares, error: shareErr } = await supabase
      .from('folder_shares')
      .select('*, folders(*, users(name, email))')
      .eq('shared_to_email', req.user.email.trim().toLowerCase());

    if (shareErr) throw shareErr;

    // Format output
    const sharedFolders = shares.map(s => {
      if (!s.folders) return null;
      return {
        ...s.folders,
        _id: s.folders.id,
        shareId: s.id,
        permissionRole: s.permission_role,
        ownerName: s.folders.users?.name || s.folders.users?.email || 'Chủ sở hữu'
      };
    }).filter(Boolean);

    res.status(200).json(sharedFolders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 5. Add a comment to a document
const addDocumentComment = async (req, res) => {
  try {
    const { documentId, content, parentId } = req.body;
    if (!documentId || !content) {
      return res.status(400).json({ error: 'Mã tài liệu và nội dung bình luận là bắt buộc' });
    }

    // Verify user has access to document
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
      return res.status(403).json({ error: 'Bạn không có quyền thảo luận trên tài liệu này' });
    }

    // Insert comment
    const { data: comment, error: commentErr } = await supabase
      .from('document_comments')
      .insert([{
        document_id: documentId,
        user_id: req.user.id,
        content,
        parent_id: parentId || null
      }])
      .select('*, users(name, email, avatar_url)')
      .single();

    if (commentErr) throw commentErr;

    // Notify document owner if comment is not by themselves
    if (doc.user_id !== req.user.id) {
      try {
        await createNotification(req, {
          recipientId: doc.user_id,
          type: 'document_comment',
          title: 'Bình luận mới trên tài liệu',
          message: `Người dùng ${req.user.name || req.user.email} đã bình luận trên tài liệu của bạn.`
        });
      } catch (e) {
        console.error('Error sending comment notification:', e);
      }
    }

    // Emit comment socket event for real-time
    if (req.io) {
      req.io.emit('comment_added', comment);
    }

    res.status(201).json(comment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 6. Get all comments for a document
const getDocumentComments = async (req, res) => {
  try {
    const { documentId } = req.params;

    // Verify user has access to document
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

    // Fetch comments
    const { data: comments, error } = await supabase
      .from('document_comments')
      .select('*, users(name, email, avatar_url)')
      .eq('document_id', documentId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.status(200).json(comments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  shareFolder,
  getFolderShares,
  deleteFolderShare,
  getSharedFolders,
  addDocumentComment,
  getDocumentComments
};
