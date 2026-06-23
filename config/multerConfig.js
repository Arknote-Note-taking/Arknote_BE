const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Distinguish between documents and avatars if needed, 
    // or just put everything in uploads/
    const dest = file.fieldname === 'avatar' ? 'uploads/avatars/' : 'uploads/';
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit (enforced dynamically per user plan in controller)
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'avatar') {
      if (!file.mimetype.startsWith('image/')) {
        return cb(new Error('Chỉ cho phép tải lên tệp hình ảnh!'), false);
      }
    }
    cb(null, true);
  }
});

module.exports = upload;
