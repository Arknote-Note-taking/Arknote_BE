const fs = require('fs');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const path = require('path');

const extractTextFromFile = async (filePath, mimetype) => {
  try {
    if (mimetype === 'application/pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      let parser = typeof pdfParse === 'function' ? pdfParse : pdfParse.default;
      if (typeof parser !== 'function') throw new Error('pdf-parse module loaded incorrectly.');
      const data = await parser(dataBuffer);
      return data.text;
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
