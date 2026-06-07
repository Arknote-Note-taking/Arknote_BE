const fs = require('fs');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const path = require('path');

const extractTextFromFile = async (filePath, mimetype) => {
  try {
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
