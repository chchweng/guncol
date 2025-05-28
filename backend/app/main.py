from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import shutil
import os
from pydantic import BaseModel # For request body validation
from typing import List

# Import the SAM service and its loader
from .services.segmentation_service import load_sam_model, get_image_segmentation_masks, SAM_CHECKPOINT_PATH, MODEL_TYPE, DEVICE

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

# --- Pydantic Models for API --- 
class PointPrompt(BaseModel):
    x: float
    y: float
    label: int # 1 for foreground, 0 for background

class SegmentationRequest(BaseModel):
    image_name: str # Filename of the uploaded image
    prompts: List[PointPrompt]

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
    filename = os.path.basename(str(file.filename)) 
    if not filename: # Handle cases where filename might be empty or invalid
        raise HTTPException(status_code=400, detail="Invalid filename.")

    file_location = os.path.join(UPLOAD_DIR, filename)
    try:
        with open(file_location, "wb+") as file_object:
            shutil.copyfileobj(file.file, file_object)
        return {"info": f"File '{filename}' saved at '{file_location}'", "image_name": filename}
    except Exception as e:
        # Log the exception for debugging
        print(f"Error saving uploaded file {filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Could not save file: {e}")

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

# To run this application:
# 1. Make sure you are in the 'backend' directory.
# 2. Create a virtual environment: python -m venv .venv
# 3. Activate it: source .venv/bin/activate (on Linux/macOS) or .venv\Scripts\activate (on Windows)
# 4. Install dependencies: pip install -r requirements.txt
# 5. Run uvicorn: uvicorn app.main:app --reload 

# Need to import SAM_PREDICTOR to check its status in the root endpoint
from .services.segmentation_service import SAM_PREDICTOR 