const fs = require('fs');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const path = require('path');
const { execFile } = require('child_process');

const extractWithMarkItDown = async (filePath) => {
  // Read file from disk and construct Blob to send via native FormData
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const blob = new Blob([fileBuffer]);
  
  const formData = new FormData();
  formData.append('file', blob, fileName);

  const response = await fetch('http://127.0.0.1:5001/convert', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FastAPI response error ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  return result.markdown;
};

const extractTextFromFile = async (filePath, mimetype) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const markitdownSupportedExts = ['.pdf', '.docx', '.xlsx', '.pptx', '.htm', '.html', '.zip', '.json', '.xml', '.csv'];

    if (markitdownSupportedExts.includes(ext)) {
      try {
        console.log(`[MarkItDown] Attempting extraction for: ${filePath}`);
        const text = await extractWithMarkItDown(filePath);
        if (text && text.trim().length > 0) {
          console.log(`[MarkItDown] Successfully extracted content from: ${filePath}`);
          return text;
        }
        console.warn(`[MarkItDown] Extracted text was empty, falling back for: ${filePath}`);
      } catch (err) {
        console.error(`[MarkItDown] Failed, falling back to legacy parser for: ${filePath}`, err);
      }
    }

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
      const { data: { text } } = await Tesseract.recognize(filePath, 'eng');
      return text;
    } else {
      // Fallback for txt or other raw text files
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (error) {
    console.error('File Extraction Error:', error);
    return '';
  }
};

module.exports = { extractTextFromFile };

