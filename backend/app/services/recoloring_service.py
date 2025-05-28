import cv2
import numpy as np
import os

def hex_to_hsl(hex_color: str):
    """Converts a hex color string to HSL values (H: 0-179, S: 0-255, L: 0-255 for OpenCV)."""
    hex_color = hex_color.lstrip('#')
    h_len = len(hex_color)
    rgb = tuple(int(hex_color[i:i + h_len // 3], 16) for i in range(0, h_len, h_len // 3))
    
    # Convert RGB to a BGR numpy array (OpenCV format for color conversion)
    # Note: OpenCV expects a 3D array for cvtColor, so we create a 1x1 pixel image
    bgr_color = np.uint8([[rgb[::-1]]]) # RGB to BGR
    
    hsv_color = cv2.cvtColor(bgr_color, cv2.COLOR_BGR2HSV_FULL) # Using HSV_FULL for H range 0-255
    # For HSL (actually HLS in OpenCV)
    # hsl_color = cv2.cvtColor(bgr_color, cv2.COLOR_BGR2HLS_FULL)
    # HLS_FULL: H (0-255), L (0-255), S (0-255)
    # For consistency with common understanding of HSL, and because HSV is often better for this:
    # We will use HSV and treat V (Value) as L (Lightness) for preservation.
    # H (0-179 or 0-255), S (0-255), V (0-255)
    # Using HSV_FULL to get H in 0-255 range if desired, but OpenCV's default HSV H is 0-179.
    # Let's stick to OpenCV's default HSV (H range 0-179) for simplicity first.
    
    hsv_pixel = cv2.cvtColor(bgr_color, cv2.COLOR_BGR2HSV)
    return hsv_pixel[0][0] # H, S, V


def recolor_segment_hsv(image_path: str, mask: np.ndarray, target_hex_color: str) -> str:
    """
    Recolors the specified segment of an image using HSV color space manipulation.
    The original Value (brightness) is preserved to maintain texture and lighting.

    Args:
        image_path (str): Path to the original image.
        mask (np.ndarray): A 2D boolean numpy array where True indicates the segment to recolor.
                           It must have the same height and width as the image.
        target_hex_color (str): The target color in hex format (e.g., "#FF0000").

    Returns:
        str: Path to the modified (recolored) image. Overwrites the original image.
    """
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image not found at {image_path}")

    img_bgr = cv2.imread(image_path)
    if img_bgr is None:
        raise ValueError(f"Could not read image from {image_path}")

    # Ensure mask is a boolean array of the same H, W dimensions as the image
    if mask.shape[0] != img_bgr.shape[0] or mask.shape[1] != img_bgr.shape[1]:
        raise ValueError("Mask dimensions do not match image dimensions.")
    if mask.dtype != bool:
        mask = mask.astype(bool) # Ensure it's boolean

    # Convert the original image to HSV
    img_hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)

    # Get target H, S, V values from the hex color
    # We will use the H and S from the target color, and V from the original image.
    target_h, target_s, _ = hex_to_hsl(target_hex_color) # We get H,S,V but only use H,S

    # Iterate over each pixel
    # This can be slow for large images/masks. Vectorized operations are faster.
    # For pixels where the mask is True, change their H and S values.
    
    # Get all coordinates where mask is True
    row_indices, col_indices = np.where(mask)

    # Modify H, S, V values for the masked region
    # img_hsv[mask] would give a flattened array of HSV pixels.
    # We need to modify them in place or construct a new HSV array.
    
    for r, c in zip(row_indices, col_indices):
        # original_h, original_s, original_v = img_hsv[r, c]
        img_hsv[r, c][0] = target_h  # Set Hue to target Hue
        img_hsv[r, c][1] = target_s  # Set Saturation to target Saturation
        # img_hsv[r, c][2] remains original_v (Value/Lightness)

    # Convert the modified HSV image back to BGR
    recolored_img_bgr = cv2.cvtColor(img_hsv, cv2.COLOR_HSV2BGR)

    # Overwrite the original image file
    # In a more complex app, you might save to a new file or manage versions.
    cv2.imwrite(image_path, recolored_img_bgr)
    
    print(f"Image {image_path} recolored with {target_hex_color} for the given mask.")
    return image_path

if __name__ == '__main__':
    # Example Usage (for testing this file directly)
    print("Testing recoloring service...")
    # Create a dummy image and mask for testing
    dummy_image_path = os.path.join(os.path.dirname(__file__), "..", "..", "uploaded_images", "test_recolor.png")
    
    # Create a 300x300 image with a gradient and a distinct region
    test_img = np.zeros((300, 300, 3), dtype=np.uint8)
    for i in range(300): # Simple gradient
        test_img[i, :] = (i/2, 100 + i/2, 50 + i/2) 
    cv2.rectangle(test_img, (50, 50), (150, 150), (0, 255, 0), -1) # Green rectangle
    cv2.imwrite(dummy_image_path, test_img)
    print(f"Dummy test image saved to {dummy_image_path}")

    # Create a boolean mask for the rectangle region
    dummy_mask = np.zeros((300, 300), dtype=bool)
    dummy_mask[50:151, 50:151] = True # Mask for the green rectangle

    target_color_hex = "#FF00FF" # Magenta

    try:
        print(f"Applying color {target_color_hex} to masked region of {dummy_image_path}...")
        recolored_path = recolor_segment_hsv(dummy_image_path, dummy_mask, target_color_hex)
        print(f"Recoloring complete. Modified image saved at: {recolored_path}")
        
        # To verify, you'd open the image and check if the green square is now magenta
        # but with its original lighting/texture (if it had any complex texture).
        # Our dummy example is flat, so it will just change color.

        # Test with a different color
        target_color_hex_blue = "#0000FF" # Blue
        # Re-read the original for a clean test (or copy it before first recolor)
        cv2.imwrite(dummy_image_path, test_img) # Restore original for next test
        print(f"Restored original. Applying color {target_color_hex_blue}...")
        recolored_path_blue = recolor_segment_hsv(dummy_image_path, dummy_mask, target_color_hex_blue)
        print(f"Recoloring to blue complete: {recolored_path_blue}")

    except Exception as e:
        print(f"Error during testing: {e}")

    # You might want to have a more complex test image with actual textures to see the V preservation.
    # Consider adding such an image to your uploaded_images folder for manual testing. 