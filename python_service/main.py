import os
import shutil
import tempfile
from fastapi import FastAPI, UploadFile, File, HTTPException
from markitdown import MarkItDown

app = FastAPI(title="MarkItDown Converter Service")

# Initialize MarkItDown once at startup to keep it in RAM
md = MarkItDown()

@app.post("/convert")
async def convert_file(file: UploadFile = File(...)):
    # Get extension
    filename = file.filename
    _, ext = os.path.splitext(filename)
    
    # Save the uploaded file temporarily to run MarkItDown
    # Using delete=False for Windows compatibility
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as temp_file:
            shutil.copyfileobj(file.file, temp_file)
            temp_path = temp_file.name
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save temp file: {str(e)}")
            
    try:
        # Perform conversion
        result = md.convert(temp_path)
        markdown_text = result.text_content
        return {"filename": filename, "markdown": markdown_text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"MarkItDown conversion failed: {str(e)}")
    finally:
        # Clean up temp file
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5001)
