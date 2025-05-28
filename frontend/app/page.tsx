'use client';

import React, { useState, ChangeEvent, DragEvent, MouseEvent, useRef, useEffect, CSSProperties } from 'react';
import axios from 'axios';

interface Mask {
  // The structure of a mask will depend on what SAM actually returns and how we process it.
  // For now, let's assume it might be a 2D array of booleans or numbers.
  // We will receive it as a list of lists of booleans from the backend.
  segmentation: boolean[][]; // Raw mask data
  bbox: { x: number; y: number; width: number; height: number }; // Calculated BBox
  area: number;
  id: string; // Changed to string for robust unique IDs (e.g., UUID or timestamp-based)
  color?: string; // For displaying the mask with a specific color
  promptGroupId?: string; // To associate masks with the prompts that generated them
}

interface PointPrompt {
  x: number;
  y: number;
  label: 0 | 1; // 0 for background, 1 for foreground
  id: string; // For unique key in React list
}

let maskIdCounter = 0; // Simple counter for unique mask IDs across multiple segmentations
let pointIdCounter = 0;

export default function HomePage() {
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadedImageName, setUploadedImageName] = useState<string | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSegmenting, setIsSegmenting] = useState<boolean>(false);
  const [isRecoloring, setIsRecoloring] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [stagingMasks, setStagingMasks] = useState<Mask[]>([]); // For masks pending user selection
  const [segmentedMasks, setSegmentedMasks] = useState<Mask[]>([]); // Finalized masks
  const [currentPrompts, setCurrentPrompts] = useState<PointPrompt[]>([]);
  const [currentPromptGroupId, setCurrentPromptGroupId] = useState<string | null>(null); // Store the ID of the current staging group
  const [currentPromptLabel, setCurrentPromptLabel] = useState<0 | 1>(1); // Default to foreground
  const [hoveredMaskId, setHoveredMaskId] = useState<string | null>(null); // For hover preview
  const [imageDimensions, setImageDimensions] = useState<{width: number, height: number, naturalWidth: number, naturalHeight: number} | null>(null);

  const [selectedColor, setSelectedColor] = useState<string>('#FF69B4'); // Default to HotPink
  const imageDisplayRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null); // Ref for the actual <img> element
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const resetImageState = () => {
    setUploadedImageUrl(null);
    setUploadedImageName(null);
    setCurrentPromptGroupId(null); // Reset group ID
    setStagingMasks([]); 
    setSegmentedMasks([]);
    setCurrentPrompts([]);
    setError(null);
    setImageDimensions(null);
    maskIdCounter = 0;
    pointIdCounter = 0;
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const handleClearAllMasks = () => {
    setSegmentedMasks([]);
    if (canvasRef.current && imageRef.current) { // Clear canvas and redraw existing staged points if any
        const ctx = canvasRef.current.getContext('2d');
        ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        // No need to redraw points here, as they are separate DOM elements. Canvas only shows final masks.
    }
    console.log("All final masks cleared.");
  };

  const handleClearCurrentPoints = () => {
    setCurrentPrompts([]);
    pointIdCounter = 0; // Reset if needed, or use more robust IDs
    console.log("Current points cleared.");
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      setSelectedImageFile(file);
      if (previewUrl) URL.revokeObjectURL(previewUrl); // Revoke old blob URL for small preview
      setPreviewUrl(URL.createObjectURL(file)); // Set new blob URL for small preview
      resetImageState(); // Full reset for a new file selection
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.files && event.dataTransfer.files[0]) {
      const file = event.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        setSelectedImageFile(file);
        if (previewUrl) URL.revokeObjectURL(previewUrl); // Revoke old blob URL for small preview
        setPreviewUrl(URL.createObjectURL(file)); // Set new blob URL for small preview
        resetImageState();
      } else {
        setError('Invalid file type. Please upload an image.');
      }
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
    const img = event.currentTarget;
    setImageDimensions({
        width: img.offsetWidth, // Rendered width
        height: img.offsetHeight, // Rendered height
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
    });
    // Also set canvas display size to match image's rendered size
    if(canvasRef.current){
        canvasRef.current.style.width = `${img.offsetWidth}px`;
        canvasRef.current.style.height = `${img.offsetHeight}px`;
    }
  };

  const handleImageUpload = async () => {
    if (!selectedImageFile) {
      setError('Please select an image first.');
      return;
    }

    // Reset relevant states before new upload, but keep selectedFile and its previewUrl
    setUploadedImageUrl(null);
    setUploadedImageName(null);
    setStagingMasks([]);
    setSegmentedMasks([]);
    setCurrentPrompts([]);
    setImageDimensions(null);
    maskIdCounter = 0;
    pointIdCounter = 0;
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    // The small previewUrl (blob) is already set by handleFileChange/handleDrop

    setIsLoading(true);
    setError(null);
    
    const formData = new FormData();
    formData.append('file', selectedImageFile);

    try {
      const uploadResponse = await axios.post('http://localhost:8000/upload-image/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      setUploadedImageName(uploadResponse.data.image_name);
      // Construct the server URL for the uploaded image for the main display
      const serverImageUrl = `http://localhost:8000/uploaded_images/${uploadResponse.data.image_name}`;
      setUploadedImageUrl(serverImageUrl);
      setError(null);
      console.log('Image uploaded:', uploadResponse.data.image_name, 'Serving from:', serverImageUrl);

    } catch (err) {
      console.error('Upload error:', err);
      handleApiError(err, 'upload');
      setUploadedImageUrl(null); // Clear if upload failed
      setUploadedImageName(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddPointOnClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!uploadedImageName || !imageRef.current || !imageDimensions || !imageDisplayRef.current) {
      setError("Please upload an image and ensure it's loaded before adding points.");
      return;
    }

    const imgElement = imageRef.current;
    const containerElement = imageDisplayRef.current; // The div handling the click

    // Get bounding client rect for the image and its container (the div that received the click)
    const imgRect = imgElement.getBoundingClientRect();
    const containerRect = containerElement.getBoundingClientRect(); 

    // Click position relative to the container element (imageDisplayRef)
    const clickXInContainer = event.clientX - containerRect.left;
    const clickYInContainer = event.clientY - containerRect.top;

    // Position of the top-left of the img tag relative to the container element
    const imgOffsetXInContainer = imgRect.left - containerRect.left;
    const imgOffsetYInContainer = imgRect.top - containerRect.top;
    
    // Dimensions of the displayed image content (respecting object-fit: contain)
    const { naturalWidth, naturalHeight } = imgElement;
    const displayWidth = imgElement.offsetWidth; // Rendered width of <img> tag
    const displayHeight = imgElement.offsetHeight; // Rendered height of <img> tag

    const imageAspectRatio = naturalWidth / naturalHeight;
    const displayAspectRatio = displayWidth / displayHeight;

    let renderedImageContentWidth, renderedImageContentHeight;
    let contentOffsetXWithinImg, contentOffsetYWithinImg; // Padding inside the <img> tag due to object-fit

    if (imageAspectRatio > displayAspectRatio) {
        renderedImageContentWidth = displayWidth;
        renderedImageContentHeight = displayWidth / imageAspectRatio;
        contentOffsetXWithinImg = 0;
        contentOffsetYWithinImg = (displayHeight - renderedImageContentHeight) / 2;
    } else {
        renderedImageContentHeight = displayHeight;
        renderedImageContentWidth = displayHeight * imageAspectRatio;
        contentOffsetXWithinImg = (displayWidth - renderedImageContentWidth) / 2;
        contentOffsetYWithinImg = 0;
    }

    // Click position relative to the top-left of the *rendered image content*
    // First, adjust click from container-relative to img-tag-relative
    const clickXInImg = clickXInContainer - imgOffsetXInContainer;
    const clickYInImg = clickYInContainer - imgOffsetYInContainer;

    // Then, adjust for padding within the img tag
    const clickXOnRenderedContent = clickXInImg - contentOffsetXWithinImg;
    const clickYOnRenderedContent = clickYInImg - contentOffsetYWithinImg;

    if (clickXOnRenderedContent < 0 || clickXOnRenderedContent > renderedImageContentWidth || 
        clickYOnRenderedContent < 0 || clickYOnRenderedContent > renderedImageContentHeight) {
      console.log("Clicked outside the effective image content area.");
      return;
    }

    const finalX = Math.round(clickXOnRenderedContent * (naturalWidth / renderedImageContentWidth));
    const finalY = Math.round(clickYOnRenderedContent * (naturalHeight / renderedImageContentHeight));
    
    // Add the new point to currentPrompts list
    pointIdCounter++;
    const newPrompt: PointPrompt = { x: finalX, y: finalY, label: currentPromptLabel, id: `point-${Date.now()}-${pointIdCounter}` };
    setCurrentPrompts(prevPrompts => [...prevPrompts, newPrompt]);
    console.log('Point added:', newPrompt);
  };

  const handleSegmentFromPoints = async () => {
    if (!uploadedImageName) {
      setError("No image uploaded.");
      return;
    }
    if (currentPrompts.length === 0) {
      setError("Please add at least one point prompt.");
      return;
    }

    setIsSegmenting(true);
    setError(null);
    setStagingMasks([]); // Clear previous staging masks before new request

    const pointsForApi = currentPrompts.map(p => ({ x: p.x, y: p.y, label: p.label }));
    const newPromptGroupId = `prompt-group-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    setCurrentPromptGroupId(newPromptGroupId); // Set the current group ID

    try {
      const segmentationResponse = await axios.post('http://localhost:8000/segment-image/', {
        image_name: uploadedImageName,
        prompts: pointsForApi 
      });
      const rawMasks = segmentationResponse.data.masks; 
      if (rawMasks && rawMasks.length > 0) {
        const newProcessedMasks: Mask[] = rawMasks.map((maskData: boolean[][], index: number) => {
          let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1; let area = 0;
          maskData.forEach((row, rIndex) => {
            row.forEach((pixel, cIndex) => {
              if (pixel) {
                area++;
                if (rIndex < minY) minY = rIndex; if (rIndex > maxY) maxY = rIndex;
                if (cIndex < minX) minX = cIndex; if (cIndex > maxX) maxX = cIndex;
              }
            });
          });
          const bbox = (minX === Infinity) ? { x: 0, y: 0, width: 0, height: 0 } : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };       
          maskIdCounter++; 
          return { 
            id: `mask-${Date.now()}-${maskIdCounter}`,
            promptGroupId: newPromptGroupId, // Assign group ID from the state
            segmentation: maskData, 
            bbox: bbox, 
            area: area, 
            // Do not assign selectedColor here, staging masks are neutral until selected/colored
          };
        }).filter((mask: Mask) => mask.area > 0); 
        
        if (newProcessedMasks.length > 0) {
          setStagingMasks(newProcessedMasks);
          // Don't clear currentPrompts here, user might want to refine them if no good mask is staged
          // currentPrompts will be cleared when a staging mask is chosen or all are discarded.
        } else {
           setError(rawMasks.length > 0 ? "SAM returned masks, but they were all empty/small." : "No masks generated for these points.");
        }
      } else {
        setError("No masks returned from SAM for these points.");
      }
    } catch (err) {
      console.error('Segmentation error:', err);
      handleApiError(err, 'segmentation');
    } finally {
      setIsSegmenting(false);
    }
  };

  const handleApiError = (err: any, type: 'upload' | 'segmentation' | 'recolor') => {
    if (axios.isAxiosError(err) && err.response) setError(`Error (${type}): ${err.response.status} - ${err.response.data.detail || err.message}`);
    else if (err instanceof Error) setError(`Error (${type}): ${err.message}`);
    else setError(`An unexpected ${type} error occurred.`);
  };
  
  useEffect(() => {
    if (canvasRef.current && imageRef.current && uploadedImageUrl && imageDimensions) {
      const canvas = canvasRef.current; 
      const ctx = canvas.getContext('2d'); 
      const img = imageRef.current;
      const { naturalWidth, naturalHeight } = imageDimensions;

      if (naturalWidth === 0 || naturalHeight === 0) {
        console.warn("Attempted to draw on canvas with zero dimensions.");
        return;
      }

      if (canvas.width !== naturalWidth || canvas.height !== naturalHeight) {
        canvas.width = naturalWidth;
        canvas.height = naturalHeight;
      }
      const styleWidth = `${img.offsetWidth}px`;
      const styleHeight = `${img.offsetHeight}px`;
      if (canvas.style.width !== styleWidth) canvas.style.width = styleWidth;
      if (canvas.style.height !== styleHeight) canvas.style.height = styleHeight;
      
      ctx?.clearRect(0,0, canvas.width, canvas.height); 

      // Draw all segmented (finalized) masks first
      segmentedMasks.forEach(mask => {
        if (!ctx) return;
        const tempCanvas = document.createElement('canvas'); 
        tempCanvas.width = naturalWidth; 
        tempCanvas.height = naturalHeight;
        const tempCtx = tempCanvas.getContext('2d'); 
        if (!tempCtx) return;

        const maskImageData = tempCtx.createImageData(naturalWidth, naturalHeight);
        const data = maskImageData.data; 
        // Use the mask's own color if it has one (from recoloring), otherwise the global selectedColor for new masks
        const drawColor = mask.color || selectedColor; 
        const colorToDraw = hexToRgba(drawColor, 0.5); // Standard opacity for regular masks
        
        for (let r = 0; r < naturalHeight; r++) {
          for (let c = 0; c < naturalWidth; c++) {
            const index = (r * naturalWidth + c) * 4;
            if (mask.segmentation && mask.segmentation[r] && mask.segmentation[r][c]) {
              data[index] = colorToDraw.r; 
              data[index + 1] = colorToDraw.g; 
              data[index + 2] = colorToDraw.b; 
              data[index + 3] = colorToDraw.a; 
            }
          }
        }
        tempCtx.putImageData(maskImageData, 0, 0);
        ctx.drawImage(tempCanvas, 0, 0); 
      });

      // Draw staging masks if any - with a neutral/default preview color
      stagingMasks.forEach(mask => {
        if (!ctx) return;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = naturalWidth;
        tempCanvas.height = naturalHeight;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;
        const maskImageData = tempCtx.createImageData(naturalWidth, naturalHeight);
        const data = maskImageData.data;
        const stagingColor = hexToRgba("#808080", 0.4); // Grey for staging masks
        for (let r = 0; r < naturalHeight; r++) {
          for (let c = 0; c < naturalWidth; c++) {
            const index = (r * naturalWidth + c) * 4;
            if (mask.segmentation && mask.segmentation[r] && mask.segmentation[r][c]) {
              data[index] = stagingColor.r;
              data[index + 1] = stagingColor.g;
              data[index + 2] = stagingColor.b;
              data[index + 3] = stagingColor.a;
            }
          }
        }
        tempCtx.putImageData(maskImageData, 0, 0);
        ctx.drawImage(tempCanvas, 0, 0);
      });

      // If a mask is being hovered (either staging or finalized), draw it with higher opacity or a distinct preview style
      if (hoveredMaskId) {
        const maskToPreview =
          stagingMasks.find(m => m.id === hoveredMaskId) ||
          segmentedMasks.find(m => m.id === hoveredMaskId);
        
        if (maskToPreview && ctx) {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = naturalWidth;
          tempCanvas.height = naturalHeight;
          const tempCtx = tempCanvas.getContext('2d');
          if (!tempCtx) return;

          const maskImageData = tempCtx.createImageData(naturalWidth, naturalHeight);
          const data = maskImageData.data;
          // Use a distinct preview color/opacity, e.g., yellow with higher opacity
          const previewColor = hexToRgba("#FFFF00", 0.75); // Yellow preview, slightly more opaque

          for (let r = 0; r < naturalHeight; r++) {
            for (let c = 0; c < naturalWidth; c++) {
              const index = (r * naturalWidth + c) * 4;
              if (maskToPreview.segmentation && maskToPreview.segmentation[r] && maskToPreview.segmentation[r][c]) {
                data[index] = previewColor.r;
                data[index + 1] = previewColor.g;
                data[index + 2] = previewColor.b;
                data[index + 3] = previewColor.a;
              }
            }
          }
          tempCtx.putImageData(maskImageData, 0, 0);
          ctx.drawImage(tempCanvas, 0, 0);
        }
      }

    } else if (canvasRef.current && (!uploadedImageUrl || segmentedMasks.length === 0)) { // Clear if no image or no masks
        const canvas = canvasRef.current; 
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
        // Optional: Reset canvas style if no image is displayed or no masks
        // canvas.style.width = '100%';
        // canvas.style.height = '100%';
    }
  }, [segmentedMasks, stagingMasks, uploadedImageUrl, selectedColor, imageDimensions, hoveredMaskId]); // Add hoveredMaskId to dependency array

  const handleRecolorMask = async (maskId: string) => {
    const maskToRecolor = segmentedMasks.find(m => m.id === maskId);
    if (!maskToRecolor) {
      setError("Mask not found for recoloring.");
      return;
    }
    if (!uploadedImageName) {
      setError("Uploaded image name not found. Please upload again.")
      return;
    }
    if (!maskToRecolor.segmentation || maskToRecolor.segmentation.length === 0) {
      setError("Mask data is empty or invalid for recoloring.");
      return;
    }

    console.log(`Attempting to recolor mask ${maskId} of image ${uploadedImageName} with ${selectedColor}`);
    setIsRecoloring(true);
    setError(null);

    try {
      const response = await axios.post('http://localhost:8000/recolor-image/', {
        image_name: uploadedImageName,
        mask: maskToRecolor.segmentation, // Send the raw boolean mask data
        target_hex_color: selectedColor,
      });

      console.log('Recoloring API response:', response.data);

      // Update the mask's color in the state for visual feedback on the list item
      setSegmentedMasks(prevMasks => 
        prevMasks.map(m => m.id === maskId ? {...m, color: selectedColor} : m)
      );

      // Force a reload of the displayed image from the server to show the backend changes
      // uploadedImageUrl should now be the direct server URL
      if (uploadedImageUrl) { 
        const baseUrl = uploadedImageUrl.split('?')[0];
        setUploadedImageUrl(`${baseUrl}?t=${new Date().getTime()}`);
        console.log("Refreshing image from server:", `${baseUrl}?t=${new Date().getTime()}`);
      }
      setError(null); // Clear any previous errors

    } catch (err) {
      console.error('Recoloring error:', err);
      handleApiError(err, 'recolor'); // New error type 'recolor'
    } finally {
      setIsRecoloring(false);
    }
  };

  const handleColorChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedColor(event.target.value);
  };

  const hexToRgba = (hex: string, alpha: number = 1) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b, a: Math.floor(alpha * 255) }; 
  };

  const getVisualPointPosition = (point: PointPrompt): CSSProperties => {
    if (!imageRef.current || !imageDisplayRef.current) return { display: 'none' }; 
    const imgElement = imageRef.current; const displayContainer = imageDisplayRef.current; 
    const imgRect = imgElement.getBoundingClientRect(); const displayContainerRect = displayContainer.getBoundingClientRect();
    const imgLeftOffsetInContainer = imgRect.left - displayContainerRect.left;
    const imgTopOffsetInContainer = imgRect.top - displayContainerRect.top;
    const { naturalWidth, naturalHeight } = imgElement; const imgDisplayWidth = imgElement.offsetWidth; const imgDisplayHeight = imgElement.offsetHeight;
    const naturalAspectRatio = naturalWidth / naturalHeight; const imgDisplayAspectRatio = imgDisplayWidth / imgDisplayHeight;
    let contentRenderedWidth, contentRenderedHeight; let contentPaddingX, contentPaddingY; 
    if (naturalAspectRatio > imgDisplayAspectRatio) { 
        contentRenderedWidth = imgDisplayWidth; contentRenderedHeight = imgDisplayWidth / naturalAspectRatio;
        contentPaddingX = 0; contentPaddingY = (imgDisplayHeight - contentRenderedHeight) / 2;
    } else { 
        contentRenderedHeight = imgDisplayHeight; contentRenderedWidth = imgDisplayHeight * naturalAspectRatio;
        contentPaddingX = (imgDisplayWidth - contentRenderedWidth) / 2; contentPaddingY = 0;
    }
    const clickXOnRenderedContent = (point.x / naturalWidth) * contentRenderedWidth;
    const clickYOnRenderedContent = (point.y / naturalHeight) * contentRenderedHeight;
    const finalDotLeft = imgLeftOffsetInContainer + contentPaddingX + clickXOnRenderedContent;
    const finalDotTop = imgTopOffsetInContainer + contentPaddingY + clickYOnRenderedContent;
    return { position: 'absolute', left: `${finalDotLeft}px`, top: `${finalDotTop}px` };
  };

  const handleSelectStagingMask = (maskIdToSelect: string) => {
    const selectedMask = stagingMasks.find(m => m.id === maskIdToSelect);
    if (selectedMask) {
      // Add the selected mask to final masks, potentially with the current global selectedColor as a default
      setSegmentedMasks(prev => [...prev, { ...selectedMask, color: selectedMask.color || selectedColor }]);
      setStagingMasks([]); // Clear all staging masks
      setCurrentPrompts([]); // Clear current prompts
      setCurrentPromptGroupId(null); // Reset group ID
      pointIdCounter = 0; // Reset point counter for next set of prompts
      console.log("Staging mask selected and finalized:", selectedMask.id);
    }
  };

  const handleDiscardStagingGroup = () => {
    console.log("Discarding current staging group:", currentPromptGroupId);
    setStagingMasks([]); // Clear all staging masks
    // Optionally, clear currentPrompts if you want to force user to start new points after discarding
    // setCurrentPrompts([]); 
    // pointIdCounter = 0;
    setCurrentPromptGroupId(null);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-4 md:p-8">
      <header className="w-full max-w-4xl mb-8 md:mb-12 text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-500 to-red-500">
          Gunpla Interactive Colorizer
        </h1>
        <p className="text-lg md:text-xl text-gray-300 mt-3 md:mt-4">
          Upload image, click points, generate mask, pick a color, and see it transform!
        </p>
      </header>

      <main className="w-full max-w-5xl bg-gray-800 shadow-2xl rounded-lg p-4 md:p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 items-start">
          {/* Left Column: Upload and Controls */} 
          <div className="space-y-6">
            <div 
              className="w-full h-60 md:h-72 border-4 border-dashed border-gray-600 rounded-lg flex flex-col justify-center items-center cursor-pointer hover:border-purple-400 transition-colors duration-300 bg-gray-700 bg-opacity-30"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => document.getElementById('fileInput')?.click()} 
            >
              <input 
                type="file" 
                id="fileInput"
                accept="image/*" 
                onChange={handleFileChange} 
                className="hidden" 
              />
              {previewUrl ? (
                <img src={previewUrl} alt="Preview" className="max-h-full max-w-full object-contain rounded" />
              ) : (
                <div className="text-center text-gray-400 p-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 md:h-16 md:w-16 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p>Drag & drop image or click</p>
                  <p className="text-xs md:text-sm">Supports JPG, PNG, WEBP</p>
                </div>
              )}
            </div>

            {selectedImageFile && (
              <button
                onClick={handleImageUpload}
                disabled={isLoading || isSegmenting || isRecoloring}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-4 md:px-6 rounded-lg transition-all duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Uploading...</span>
                  </>
                ) : isRecoloring ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Recoloring...</span>
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <span>Upload Image</span>
                  </>
                )}
              </button>
            )}
            {uploadedImageUrl && !isSegmenting && !isLoading && !isRecoloring && !currentPromptGroupId && <p className="text-center text-sm text-green-400">Image uploaded! Use Point Prompts, then Generate Mask. Then pick color and a mask to recolor.</p>}
            {uploadedImageUrl && currentPromptGroupId && stagingMasks.length > 0 && <p className="text-center text-sm text-yellow-300">New masks generated! Please select one or discard.</p>}

            {error && <p className="text-red-400 bg-red-900 bg-opacity-30 p-3 rounded-md text-sm">{error}</p>}
            
            {uploadedImageUrl && !currentPromptGroupId && (
              <div className="mt-4 space-y-3 p-3 bg-gray-700 rounded-md">
                <h3 className="text-md font-semibold text-purple-300">Point Prompts:</h3>
                <div className="flex items-center space-x-4">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input type="radio" name="promptType" value={1} checked={currentPromptLabel === 1} onChange={() => setCurrentPromptLabel(1)} className="form-radio text-green-500 bg-gray-600 border-gray-500 focus:ring-green-500"/>
                    <span className="text-green-400">Foreground (+)</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input type="radio" name="promptType" value={0} checked={currentPromptLabel === 0} onChange={() => setCurrentPromptLabel(0)} className="form-radio text-red-500 bg-gray-600 border-gray-500 focus:ring-red-500"/>
                    <span className="text-red-400">Background (-)</span>
                  </label>
                </div>
                <p className="text-xs text-gray-400">Click on image to add {currentPromptLabel === 1 ? 'foreground' : 'background'} points.</p>
                {currentPrompts.length > 0 && (
                  <div className="space-y-2">
                    <button 
                      onClick={handleSegmentFromPoints} 
                      disabled={isSegmenting || isLoading || isRecoloring || currentPrompts.length === 0}
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSegmenting ? 'Segmenting...' : 'Generate Mask from Points'}
                    </button>
                    <button 
                      onClick={handleClearCurrentPoints} 
                      disabled={isSegmenting || isLoading || isRecoloring}
                      className="w-full bg-yellow-600 hover:bg-yellow-700 text-black font-semibold py-2 px-4 rounded-lg transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Clear Current Points ({currentPrompts.length})
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Staging Masks Section - visible if there are staging masks */} 
            {currentPromptGroupId && stagingMasks.length > 0 && (
              <div className="mt-6 space-y-3 p-3 bg-gray-700 border border-yellow-500 rounded-md">
                <h3 className="text-md font-semibold text-yellow-300">New Mask Proposals ({stagingMasks.length}):</h3>
                <p className="text-sm text-gray-400">Hover to preview a mask. Click "Select" to finalize one, or discard all.</p>
                <div className="max-h-40 overflow-y-auto space-y-2 pr-2">
                  {stagingMasks.map((mask) => (
                    <div key={mask.id} 
                      onMouseEnter={() => setHoveredMaskId(mask.id)}
                      onMouseLeave={() => setHoveredMaskId(null)}
                      className="p-2 rounded-md bg-gray-600 hover:bg-gray-500 flex justify-between items-center"
                    >
                      <span className="text-sm truncate" title={`Mask ID: ${mask.id}, Area: ${mask.area}px`}>
                        Staging Mask (Area: {mask.area}px)
                      </span>
                      <button 
                        onClick={() => handleSelectStagingMask(mask.id)}
                        disabled={isLoading || isSegmenting || isRecoloring}
                        className="ml-2 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold py-1 px-2 rounded-md transition-colors duration-150 disabled:opacity-50"
                      >
                        Select
                      </button>
                    </div>
                  ))}
                </div>
                <button 
                  onClick={handleDiscardStagingGroup}
                  disabled={isLoading || isSegmenting || isRecoloring}
                  className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-3 rounded-lg transition-colors duration-150 disabled:opacity-50 mt-2"
                >
                  Discard All These New Masks
                </button>
              </div>
            )}

            {/* Final Masks Section - visible if there are finalized/segmented masks */} 
            {segmentedMasks.length > 0 && (
              <div className="mt-6 space-y-3">
                <h3 className="text-md font-semibold text-purple-300">Final Masks:</h3>
                <div>
                  <label htmlFor="colorPicker" className="block text-md font-medium text-gray-300 mb-1">Recolor With:</label>
                  <input type="color" id="colorPicker" value={selectedColor} onChange={handleColorChange} className="w-full h-10 p-1 bg-gray-700 border border-gray-600 rounded-lg cursor-pointer"/>
                </div>
                <p className="text-sm text-gray-400">Select a mask below to apply the chosen color. Or clear all final masks.</p>
                <div className="max-h-48 overflow-y-auto space-y-2 pr-2">
                    {segmentedMasks.map((mask) => (
                        <button key={mask.id} 
                          onClick={() => handleRecolorMask(mask.id)} 
                          onMouseEnter={() => setHoveredMaskId(mask.id)}
                          onMouseLeave={() => setHoveredMaskId(null)}
                          disabled={isRecoloring || isSegmenting || isLoading}
                          className="w-full text-left p-2 rounded-md hover:bg-purple-700 bg-gray-700 border border-gray-600 transition-colors duration-150 text-sm truncate disabled:opacity-70 disabled:cursor-not-allowed" 
                          title={`Mask ID: ${mask.id}, Area: ${mask.area}px. Click to recolor with selected color.`}
                          style={{borderColor: mask.color || selectedColor, borderWidth: mask.color ? '2px' : '1px'}} >
                           Mask (Area: {mask.area}px) - ID: ...{mask.id.slice(-6)}
                        </button>
                    ))}
                </div>
                <button 
                  onClick={handleClearAllMasks} 
                  disabled={isSegmenting || isLoading || isRecoloring}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Clear All Final Masks
                </button>
              </div>
            )}
          </div>

          {/* Right Column: Image Display and Interaction Area */} 
          <div 
            ref={imageDisplayRef} 
            className="relative w-full md:h-[calc(100vh-250px)] h-80 bg-gray-700 rounded-lg overflow-hidden flex justify-center items-center cursor-crosshair group" // Added group for child targeting
            onClick={uploadedImageUrl && !isSegmenting && !isLoading && !isRecoloring ? handleAddPointOnClick : undefined}
          >
            {uploadedImageUrl ? (
              <img 
                ref={imageRef} // Assign ref to the image element
                src={uploadedImageUrl} 
                alt="Uploaded Gunpla" 
                className="max-h-full max-w-full object-contain select-none group-hover:opacity-90 transition-opacity duration-200" 
                onLoad={handleImageLoad} // Get dimensions once loaded
              />
            ) : (
              <p className="text-gray-500">Image will appear here after upload.</p>
            )}
            {/* Canvas for drawing masks, ensure it aligns with the image */} 
            <canvas 
                ref={canvasRef} 
                className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none group-hover:opacity-90 transition-opacity duration-200" 
                // Width and height attributes set by useEffect, style width/height also by useEffect based on imageRenderedSize
            />
            {(isLoading || isSegmenting || isRecoloring) && (
                <div className="absolute inset-0 bg-gray-800 bg-opacity-75 flex flex-col justify-center items-center z-10">
                    <svg className="animate-spin h-10 w-10 text-purple-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="mt-2 text-lg">{isLoading ? 'Uploading...' : isSegmenting ? 'Segmenting...' : isRecoloring ? 'Recoloring...' : 'Processing...'}</p>
                </div>
            )}
            {/* Display all current points */} 
            {currentPrompts.map(point => (
              <div key={point.id}
                className={`absolute rounded-full w-2.5 h-2.5 border-2 border-white pointer-events-none transform -translate-x-1/2 -translate-y-1/2 z-20 ${point.label === 1 ? 'bg-green-500' : 'bg-red-500'}`}
                style={getVisualPointPosition(point) as CSSProperties} />
            ))}
          </div>
        </div>
      </main>

      <footer className="w-full max-w-5xl mt-8 md:mt-12 text-center text-gray-500 text-sm">
        <p>&copy; {new Date().getFullYear()} Gunpla Colorizer. </p>
      </footer>
    </div>
  );
} 