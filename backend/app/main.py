from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles # Import StaticFiles
import shutil
import os
import numpy as np # For handling mask data
from pydantic import BaseModel # For request body validation
from typing import List, Any # Any for the raw mask data for now
import cv2

# Import the SAM service and its loader
from .services.segmentation_service import load_sam_model, get_image_segmentation_masks, SAM_CHECKPOINT_PATH, MODEL_TYPE, DEVICE, SAM_PREDICTOR
from .services.recoloring_service import recolor_segment_hsv, hex_to_hsl # Added recoloring service

# Define the origins that should be allowed to make cross-origin requests.
# For development, you can allow all origins with "*",
# but for production, you should restrict this to your frontend's domain.
origins = [
    "http://localhost:3000",  # Assuming Next.js runs on port 3000
    "localhost:3000" # Sometimes needed without http
]

app = FastAPI(title="Gunpla Colorizer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods (GET, POST, etc.)
    allow_headers=["*"],  # Allows all headers
)

# Directory to store uploaded images temporarily
UPLOAD_DIR = "./uploaded_images"
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)

# Mount static files directory
app.mount("/uploaded_images", StaticFiles(directory=UPLOAD_DIR), name="uploaded_images")

# --- Pydantic Models for API --- 
class PointPrompt(BaseModel):
    x: float
    y: float
    label: int # 1 for foreground, 0 for background

class SegmentationRequest(BaseModel):
    image_name: str # Filename of the uploaded image
    prompts: List[PointPrompt]

class RecolorRequest(BaseModel):
    image_name: str
    mask: List[List[bool]] # Expecting a 2D boolean array for the mask
    target_hex_color: str

# --- Application Startup Event ---
@app.on_event("startup")
async def startup_event():
    """Event handler for application startup."""
    print("Application startup: Initializing SAM...")
    print(f"Expected SAM checkpoint: {SAM_CHECKPOINT_PATH}")
    print(f"SAM model type: {MODEL_TYPE}")
    print(f"Target device: {DEVICE}")
    load_sam_model() # Load the SAM model into memory
    print("SAM initialization attempt complete.")

@app.get("/")
async def read_root():
    """Root endpoint to check if the API is running."""
    return {"message": "Welcome to the Gunpla Colorizer API!", "sam_model_loaded": SAM_PREDICTOR is not None}

@app.post("/upload-image/")
async def upload_image(file: UploadFile = File(...)):
    """
    Endpoint to upload an image.
    It saves the image to a temporary directory on the server.
    In a real application, you might want to process it immediately or store it
    more permanently (e.g., in a cloud storage bucket).
    """
    # Sanitize filename to prevent directory traversal issues
    original_filename = os.path.basename(str(file.filename))
    if not original_filename: 
        raise HTTPException(status_code=400, detail="Invalid original filename.")

    # Create a new filename with .png extension
    filename_stem = os.path.splitext(original_filename)[0]
    new_png_filename = f"{filename_stem}.png"
    
    file_location = os.path.join(UPLOAD_DIR, new_png_filename)

    try:
        # Read the uploaded file in-memory
        contents = await file.read()
        img_array = np.frombuffer(contents, np.uint8)
        img_bgr = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

        if img_bgr is None:
            raise HTTPException(status_code=400, detail=f"Could not decode image file: {original_filename}. Ensure it is a valid image format.")

        # Save the image as PNG
        cv2.imwrite(file_location, img_bgr)
        
        return {"info": f"File '{original_filename}' processed and saved as '{new_png_filename}'", "image_name": new_png_filename}
    except HTTPException as http_exc: # Re-raise HTTPExceptions directly
        raise http_exc
    except Exception as e:
        print(f"Error processing/saving uploaded file {original_filename} as PNG: {e}")
        raise HTTPException(status_code=500, detail=f"Could not process/save file as PNG: {e}")

@app.post("/segment-image/")
async def segment_image_endpoint(request: SegmentationRequest):
    """
    Endpoint to segment an image based on point prompts.
    Expects the image to have been uploaded previously.
    """
    image_path = os.path.join(UPLOAD_DIR, request.image_name)
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail=f"Image '{request.image_name}' not found in upload directory.")

    point_coords = [[p.x, p.y] for p in request.prompts]
    point_labels = [p.label for p in request.prompts]

    print(f"Received segmentation request for {request.image_name} with points: {point_coords}, labels: {point_labels}")

    masks = await get_image_segmentation_masks(image_path, point_coords, point_labels)

    if not masks:
        # This could be due to model error, image reading error, or no masks found
        # The service layer (get_image_segmentation_masks) should log more specific errors
        print(f"Segmentation returned no masks for {request.image_name}")
        # You might want to return a more specific error or an empty list based on requirements
        # For now, an empty list in the success response indicates no masks found / error in processing
        # Consider raising HTTPException for critical errors within get_image_segmentation_masks if needed.
        pass # Fall through to return empty masks list
        
    return {"image_name": request.image_name, "masks": masks}

@app.post("/recolor-image/")
async def recolor_image_endpoint(request: RecolorRequest):
    image_path = os.path.join(UPLOAD_DIR, request.image_name)
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail=f"Image '{request.image_name}' not found for recoloring.")

    try:
        # Convert the received list of lists of booleans mask to a NumPy array
        mask_np = np.array(request.mask, dtype=bool)
        
        print(f"Recoloring image: {request.image_name} with color {request.target_hex_color}")
        # The recolor_segment_hsv function overwrites the image and returns its path.
        modified_image_path = recolor_segment_hsv(image_path, mask_np, request.target_hex_color)
        
        return {
            "message": "Image segment recolored successfully.", 
            "recolored_image_name": os.path.basename(modified_image_path),
            "new_color_applied": request.target_hex_color
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e: # Catch potential errors from recolor_segment_hsv like dimension mismatch
        print(f"ValueError during recoloring: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"Unexpected error during recoloring: {e}")
        # import traceback
        # traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred during recoloring: {str(e)}")

# To run this application:
# 1. Make sure you are in the 'backend' directory.
# 2. Create a virtual environment: python -m venv .venv
# 3. Activate it: source .venv/bin/activate (on Linux/macOS) or .venv\Scripts\activate (on Windows)
# 4. Install dependencies: pip install -r requirements.txt
# 5. Run uvicorn: uvicorn app.main:app --reload 