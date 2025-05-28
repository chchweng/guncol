import numpy as np
import torch
import cv2 # OpenCV for image manipulation
from segment_anything import sam_model_registry, SamPredictor
import os
from PIL import Image # Pillow for image opening

# --- Configuration ---
# Determine the device to run the model on (GPU if available, otherwise CPU)
DEVICE = torch.device("cuda:0" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
# Define the SAM model type we are using
MODEL_TYPE = "vit_l"
# Path to the downloaded SAM checkpoint
# Assumes the checkpoint is in a 'models_checkpoints' directory at the same level as the 'app' directory
SAM_CHECKPOINT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "models_checkpoints", "sam_vit_l_0b3195.pth")

# --- Global SAM Predictor --- 
# Initialize SAM predictor as a global variable to load the model only once.
# This is a common practice for heavy models in web services to avoid reloading on every request.
SAM_PREDICTOR = None

def load_sam_model():
    """Loads the SAM model into the global SAM_PREDICTOR variable."""
    global SAM_PREDICTOR
    if SAM_PREDICTOR is None:
        print(f"Attempting to load SAM model checkpoint from: {SAM_CHECKPOINT_PATH}")
        if not os.path.exists(SAM_CHECKPOINT_PATH):
            error_msg = f"SAM checkpoint not found at {SAM_CHECKPOINT_PATH}. Please download it first."
            print(f"ERROR: {error_msg}")
            # In a real app, you might raise an exception or handle this more gracefully
            # For now, we'll let it try to load and fail if the path is incorrect.
            # raise FileNotFoundError(error_msg)
        
        print(f"Loading SAM model ({MODEL_TYPE}) to {DEVICE}...")
        try:
            sam_model = sam_model_registry[MODEL_TYPE](checkpoint=SAM_CHECKPOINT_PATH)
            sam_model.to(device=DEVICE)
            SAM_PREDICTOR = SamPredictor(sam_model)
            print("SAM model loaded successfully.")
        except Exception as e:
            print(f"Error loading SAM model: {e}")
            # SAM_PREDICTOR will remain None, and subsequent calls will fail
            # Consider how to handle this in a production environment (e.g. app can't start)

async def get_image_segmentation_masks(image_path: str, point_coords: list[list[float]], point_labels: list[int]):
    """
    Generates segmentation masks for an image given point prompts.

    Args:
        image_path (str): The path to the uploaded image.
        point_coords (list[list[float]]): A list of [x, y] coordinates for point prompts.
        point_labels (list[int]): A list of labels for the point prompts (1 for foreground, 0 for background).

    Returns:
        list: A list of masks. Each mask is a 2D numpy array where True indicates the segmented region.
              Returns an empty list if SAM is not loaded or an error occurs.
    """
    if SAM_PREDICTOR is None:
        print("Error: SAM_PREDICTOR is not initialized. Call load_sam_model() on startup.")
        return [] # Or raise an exception

    try:
        # Read the image using OpenCV
        image_bgr = cv2.imread(image_path)
        if image_bgr is None:
            print(f"Error: Could not read image from path: {image_path}")
            return []
        # Convert the image from BGR (OpenCV default) to RGB (SAM expected format)
        image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)

        # Set the image for the SAM predictor
        # This preprocesses the image and stores its embedding.
        print("Setting image in SAM predictor...")
        SAM_PREDICTOR.set_image(image_rgb)
        print("Image set successfully.")

        # Transform point_coords and point_labels into numpy arrays
        input_points = np.array(point_coords, dtype=np.float32)
        input_labels = np.array(point_labels, dtype=np.int32)

        # Make predictions using SAM
        # multimask_output=True means SAM will return multiple plausible masks for a single prompt.
        # We typically want the "best" one or to let the user choose.
        # For interactive clicking, usually one good mask is desired.
        print(f"Predicting masks with points: {input_points}, labels: {input_labels}")
        masks, scores, logits = SAM_PREDICTOR.predict(
            point_coords=input_points,
            point_labels=input_labels,
            multimask_output=True,  # Set to False if you only want the single best mask
        )
        print(f"Generated {len(masks)} masks with scores: {scores}")
        
        # `masks` is a NumPy array of shape (num_masks, height, width)
        # We will return the masks as a list of boolean NumPy arrays.
        # The client will need to know how to handle these (e.g., convert to polygons, draw on canvas).
        return masks.tolist() # Convert boolean arrays to lists of lists of booleans for JSON serialization

    except Exception as e:
        print(f"Error during SAM prediction: {e}")
        # import traceback
        # traceback.print_exc() # For more detailed error logging
        return []

# Example usage (for testing this file directly, not part of the API yet):
if __name__ == "__main__":
    # This block is for testing the service directly.
    # You would need an image in ../../uploaded_images/ for this to work.
    print("Directly testing segmentation_service.py...")
    load_sam_model() # Load the model

    if SAM_PREDICTOR is not None:
        # Create a dummy image file for testing if it doesn't exist
        # This assumes 'uploaded_images' is at the root of the 'backend' directory
        test_image_dir = os.path.join(os.path.dirname(__file__), "..", "..", "uploaded_images")
        if not os.path.exists(test_image_dir):
            os.makedirs(test_image_dir)
        
        test_image_path = os.path.join(test_image_dir, "test_gunpla.png") # Make sure this image exists
        
        # Create a simple dummy image if it doesn't exist (e.g., a 100x100 black square with a white dot)
        if not os.path.exists(test_image_path):
            print(f"Test image not found at {test_image_path}. Creating a dummy image.")
            dummy_img_data = np.zeros((100, 100, 3), dtype=np.uint8)
            cv2.circle(dummy_img_data, (50,50), 10, (255,255,255), -1) # White circle
            cv2.imwrite(test_image_path, dummy_img_data)
            print(f"Dummy image created at {test_image_path}")

        # Example point: center of the dummy image, or a point on your actual test_gunpla.png
        # For the dummy image, (50,50) is the center of the white circle.
        # Coordinates are (x, y) from top-left.
        example_point_coords = [[50.0, 50.0]] 
        example_point_labels = [1] # 1 means foreground point

        print(f"Running segmentation on {test_image_path} with point: {example_point_coords}")
        # Run segmentation
        # Note: get_image_segmentation_masks is async, but for this direct test, we call it synchronously
        # In a real FastAPI context, it would be `await get_image_segmentation_masks(...)`
        import asyncio
        generated_masks = asyncio.run(get_image_segmentation_masks(test_image_path, example_point_coords, example_point_labels))

        if generated_masks:
            print(f"Successfully generated {len(generated_masks)} masks.")
            # print("First mask shape:", np.array(generated_masks[0]).shape) # If masks are numpy arrays
            # print("First mask (first 5x5 snippet):")
            # print(np.array(generated_masks[0])[:5,:5])
        else:
            print("Mask generation failed or returned no masks.")
    else:
        print("SAM model could not be loaded. Skipping direct test.") 