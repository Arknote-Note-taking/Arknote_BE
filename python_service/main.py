import os
import shutil
import tempfile
import time
from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from markitdown import MarkItDown

app = FastAPI(title="MarkItDown Converter Service")

# Initialize MarkItDown once at startup
md = MarkItDown()

VIDEO_EXTENSIONS = {'.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'}

def convert_with_gemini_video(file_path: str, filename: str, api_key: str = None) -> str:
    """Use Gemini File API to transcribe/describe video content."""
    try:
        import google.generativeai as genai
        effective_key = api_key or os.environ.get("GEMINI_API_KEY")
        if not effective_key:
            raise ValueError("GEMINI_API_KEY not available (not in header or environment)")
        
        genai.configure(api_key=effective_key)
        
        print(f"[Gemini-Video] Uploading video file: {filename}")
        video_file = genai.upload_file(path=file_path)
        
        # Wait for file processing (video requires processing time)
        max_wait = 120  # max 2 minutes
        waited = 0
        while video_file.state.name == "PROCESSING" and waited < max_wait:
            time.sleep(3)
            waited += 3
            video_file = genai.get_file(video_file.name)
            print(f"[Gemini-Video] File state: {video_file.state.name} (waited {waited}s)")
        
        if video_file.state.name != "ACTIVE":
            raise ValueError(f"Video file processing failed. Final state: {video_file.state.name}")
        
        print(f"[Gemini-Video] File active, requesting transcript/description...")
        model = genai.GenerativeModel(model_name="gemini-2.5-flash")
        
        prompt = """Hãy phân tích video này một cách toàn diện và cung cấp:

1. **Tóm tắt nội dung**: Mô tả những gì xảy ra trong video
2. **Nội dung chính**: Liệt kê các chủ đề, thông tin, hoặc điểm quan trọng được đề cập
3. **Transcript/Lời thoại**: Nếu có lời nói hoặc văn bản xuất hiện trong video, hãy ghi lại đầy đủ
4. **Thông tin bổ sung**: Bối cảnh, ngữ cảnh, hoặc bất kỳ thông tin hữu ích nào khác

Trả lời bằng tiếng Việt, cấu trúc rõ ràng để có thể dễ dàng tìm kiếm và phân tích."""
        
        response = model.generate_content([video_file, prompt])
        
        # Clean up uploaded file from Gemini
        try:
            genai.delete_file(video_file.name)
        except:
            pass
        
        return response.text
    except Exception as e:
        print(f"[Gemini-Video] Error: {str(e)}")
        raise

@app.post("/convert")
async def convert_file(request: Request, file: UploadFile = File(...)):
    filename = file.filename
    _, ext = os.path.splitext(filename)
    ext_lower = ext.lower()
    
    # Read Gemini API key from request header (passed by Node.js service)
    gemini_api_key = request.headers.get("x-gemini-key") or os.environ.get("GEMINI_API_KEY")
    
    # Save file temporarily
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as temp_file:
            shutil.copyfileobj(file.file, temp_file)
            temp_path = temp_file.name
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save temp file: {str(e)}")
    
    try:
        # For video files, use Gemini File API
        if ext_lower in VIDEO_EXTENSIONS:
            print(f"[Convert] Video file detected: {filename}, using Gemini File API")
            try:
                text = convert_with_gemini_video(temp_path, filename, gemini_api_key)
                return {"filename": filename, "markdown": text, "method": "gemini_video"}
            except Exception as video_err:
                print(f"[Convert] Gemini video failed: {str(video_err)}, trying MarkItDown fallback")
                result = md.convert(temp_path)
                fallback_text = result.text_content or f"[Video: {filename}] - Không thể trích xuất nội dung video."
                return {"filename": filename, "markdown": fallback_text, "method": "markitdown_fallback"}
        
        # For all other files, use MarkItDown
        print(f"[Convert] Using MarkItDown for: {filename}")
        result = md.convert(temp_path)
        markdown_text = result.text_content
        return {"filename": filename, "markdown": markdown_text, "method": "markitdown"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Conversion failed: {str(e)}")
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "MarkItDown + Gemini Video Converter"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5001)
