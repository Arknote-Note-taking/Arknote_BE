const fs = require('fs');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const path = require('path');

// File type categories for user-friendly error messages
const FILE_TYPE_LABELS = {
  '.pdf': 'PDF',
  '.docx': 'Word',
  '.doc': 'Word',
  '.xlsx': 'Excel',
  '.xls': 'Excel',
  '.csv': 'CSV',
  '.pptx': 'PowerPoint',
  '.ppt': 'PowerPoint',
  '.mp4': 'Video MP4',
  '.mov': 'Video MOV',
  '.avi': 'Video AVI',
  '.mkv': 'Video MKV',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.txt': 'Văn bản',
  '.png': 'Hình ảnh',
  '.jpg': 'Hình ảnh',
  '.jpeg': 'Hình ảnh',
};

const extractWithMarkItDown = async (filePath) => {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const blob = new Blob([fileBuffer]);
  
  const formData = new FormData();
  formData.append('file', blob, fileName);

  // Pass GEMINI_API_KEY as header so Python service can use it for video
  const headers = {};
  if (process.env.GEMINI_API_KEY) {
    headers['X-Gemini-Key'] = process.env.GEMINI_API_KEY;
  }

  const response = await fetch('http://127.0.0.1:5001/convert', {
    method: 'POST',
    body: formData,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FastAPI response error ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  console.log(`[MarkItDown] Method used: ${result.method || 'markitdown'}`);
  return result.markdown;
};

const extractTextFromFile = async (filePath, mimetype) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const fileLabel = FILE_TYPE_LABELS[ext] || ext.toUpperCase().replace('.', '');
    
    const markitdownSupportedExts = [
      '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', 
      '.htm', '.html', '.zip', '.json', '.xml', '.csv',
      '.mp4', '.mov', '.avi', '.mkv', '.mp3', '.wav', '.m4a'
    ];

    const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
    const officeExts = ['.xlsx', '.xls', '.pptx', '.ppt', '.docx', '.doc', '.csv'];

    if (markitdownSupportedExts.includes(ext)) {
      try {
        console.log(`[MarkItDown] Attempting extraction for ${fileLabel}: ${filePath}`);
        const text = await extractWithMarkItDown(filePath);
        if (text && text.trim().length > 0) {
          console.log(`[MarkItDown] Successfully extracted content from ${fileLabel}: ${filePath}`);
          return text;
        }
        
        // For video/office, give informative placeholder if empty
        if (videoExts.includes(ext)) {
          console.warn(`[MarkItDown] Video content was empty for: ${filePath}`);
          return `[File video: ${path.basename(filePath)}]\n\nKhông thể trích xuất nội dung video. Có thể do:\n- File video bị hỏng\n- GEMINI_API_KEY chưa được cấu hình trong môi trường Python\n- Định dạng video không được hỗ trợ`;
        }
        if (officeExts.includes(ext)) {
          console.warn(`[MarkItDown] Office file content was empty for: ${filePath}`);
          return `[File ${fileLabel}: ${path.basename(filePath)}]\n\nFile ${fileLabel} trống hoặc không thể đọc được.`;
        }
        console.warn(`[MarkItDown] Extracted text was empty, falling back for: ${filePath}`);
      } catch (err) {
        console.error(`[MarkItDown] Failed for ${fileLabel}: ${filePath}`, err.message);
        
        // Specific messages for video and office files
        if (videoExts.includes(ext)) {
          return `[File video: ${path.basename(filePath)}]\n\nLỗi khi xử lý video: ${err.message}\n\nĐể phân tích video, hệ thống cần:\n- Python service đang chạy trên port 5001\n- GEMINI_API_KEY hợp lệ trong file .env`;
        }
        if (officeExts.includes(ext)) {
          console.log(`[MarkItDown] Falling back to legacy parser for office file: ${filePath}`);
        }
      }
    }

    // PDF fallback
    if (mimetype === 'application/pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      
      let text = '';
      if (typeof pdfParse === 'function') {
        const data = await pdfParse(dataBuffer);
        text = data.text;
      } else if (pdfParse && (pdfParse.PDFParse || (pdfParse.default && pdfParse.default.PDFParse))) {
        const PDFParseClass = pdfParse.PDFParse || pdfParse.default.PDFParse;
        const parser = new PDFParseClass({ data: dataBuffer });
        const result = await parser.getText();
        text = result.text;
      } else if (pdfParse && typeof pdfParse.default === 'function') {
        const data = await pdfParse.default(dataBuffer);
        text = data.text;
      } else {
        throw new Error('pdf-parse module loaded incorrectly.');
      }
      return text;
    } else if (mimetype.startsWith('image/')) {
      const { data: { text } } = await Tesseract.recognize(filePath, 'vie+eng');
      return text;
    } else {
      // UTF-8 text-friendly files
      const textFriendlyExts = ['.txt', '.html', '.htm', '.json', '.xml', '.md', '.csv'];
      if (textFriendlyExts.includes(ext)) {
        return fs.readFileSync(filePath, 'utf8');
      }
      return `[Tài liệu: ${path.basename(filePath)} (${fileLabel})] - Định dạng này cần Python service để đọc nội dung.`;
    }
  } catch (error) {
    console.error('File Extraction Error:', error);
    return '';
  }
};

module.exports = { extractTextFromFile };
