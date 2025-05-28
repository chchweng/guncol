'use client';

import React, { useState, ChangeEvent, DragEvent, MouseEvent, useRef, useEffect } from 'react';
import axios from 'axios';

interface Mask {
  // The structure of a mask will depend on what SAM actually returns and how we process it.
  // For now, let's assume it might be a 2D array of booleans or numbers.
  // We will receive it as a list of lists of booleans from the backend.
  segmentation: boolean[][]; // Raw mask data
  bbox: { x: number; y: number; width: number; height: number }; // Calculated BBox
  area: number;
  id: number; // A unique ID we assign or get
  color?: string; // For displaying the mask with a specific color
}

export default function HomePage() {
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadedImageName, setUploadedImageName] = useState<string | null>(null); // Store filename from backend
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null); // This will be same as preview for now

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSegmenting, setIsSegmenting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [segmentedMasks, setSegmentedMasks] = useState<Mask[]>([]);
  const [clickPoint, setClickPoint] = useState<{x: number, y: number} | null>(null);

  const [selectedColor, setSelectedColor] = useState<string>('#0000FF'); // Default to blue
  const imageDisplayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const clearStateAfterNewUpload = () => {
    setUploadedImageUrl(null);
    setUploadedImageName(null);
    setSegmentedMasks([]);
    setClickPoint(null);
    setError(null);
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      setSelectedImageFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      clearStateAfterNewUpload();
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.files && event.dataTransfer.files[0]) {
      const file = event.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        setSelectedImageFile(file);
        setPreviewUrl(URL.createObjectURL(file));
        clearStateAfterNewUpload();
      } else {
        setError('Invalid file type. Please upload an image.');
      }
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleImageUpload = async () => {
    if (!selectedImageFile) {
      setError('Please select an image first.');
      return;
    }

    setIsLoading(true);
    setError(null);
    clearStateAfterNewUpload(); // Clear previous results

    const formData = new FormData();
    formData.append('file', selectedImageFile);

    try {
      const uploadResponse = await axios.post('http://localhost:8000/upload-image/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      setUploadedImageName(uploadResponse.data.image_name);
      setUploadedImageUrl(previewUrl); // Show the preview as the "uploaded" image
      setError(null);
      console.log('Image uploaded:', uploadResponse.data.image_name);
      // Now the user can click on the image to segment

    } catch (err) {
      console.error('Upload error:', err);
      handleApiError(err, 'upload');
      setUploadedImageUrl(null);
      setUploadedImageName(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageClick = async (event: MouseEvent<HTMLDivElement>) => {
    if (!uploadedImageName || !imageDisplayRef.current) {
      setError("Please upload an image first before selecting a point.");
      return;
    }

    const rect = imageDisplayRef.current.getBoundingClientRect();
    const imgElement = imageDisplayRef.current.querySelector('img');
    if (!imgElement) return;

    // Calculate click relative to the container, then scale to actual image dimensions
    const scaleX = imgElement.naturalWidth / imgElement.offsetWidth;
    const scaleY = imgElement.naturalHeight / imgElement.offsetHeight;
    
    const xOnContainer = event.clientX - rect.left;
    const yOnContainer = event.clientY - rect.top;

    // Calculate offsets if image is letterboxed/pillarboxed
    const offsetX = (imgElement.offsetWidth - imgElement.width) / 2;
    const offsetY = (imgElement.offsetHeight - imgElement.height) / 2;

    const x = (xOnContainer - offsetX) * scaleX;
    const y = (yOnContainer - offsetY) * scaleY;

    if (x < 0 || x > imgElement.naturalWidth || y < 0 || y > imgElement.naturalHeight) {
      console.log("Clicked outside image bounds after scaling.");
      return; // Click was outside the actual image content
    }

    const newPoint = { x: Math.round(x), y: Math.round(y) };
    setClickPoint(newPoint);
    console.log('Image clicked at (scaled):', newPoint);
    setError(null);
    setIsSegmenting(true);
    setSegmentedMasks([]); // Clear old masks

    try {
      console.log(`Sending segmentation request for ${uploadedImageName} with point: ${newPoint.x}, ${newPoint.y}`);
      const segmentationResponse = await axios.post('http://localhost:8000/segment-image/', {
        image_name: uploadedImageName,
        prompts: [
          { x: newPoint.x, y: newPoint.y, label: 1 } // Label 1 for foreground point
        ]
      });

      console.log('Segmentation response:', segmentationResponse.data);
      const rawMasks = segmentationResponse.data.masks; // These are lists of lists of booleans
      
      if (rawMasks && rawMasks.length > 0) {
        const processedMasks: Mask[] = rawMasks.map((maskData: boolean[][], index: number) => {
          // Placeholder for BBox calculation - this needs actual image processing
          // For now, we'll try to find the min/max true values to form a rough BBox
          let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
          let area = 0;
          maskData.forEach((row, rIndex) => {
            row.forEach((pixel, cIndex) => {
              if (pixel) {
                area++;
                if (rIndex < minY) minY = rIndex;
                if (rIndex > maxY) maxY = rIndex;
                if (cIndex < minX) minX = cIndex;
                if (cIndex > maxX) maxX = cIndex;
              }
            });
          });
          const bbox = (minX === Infinity) ? 
            { x: 0, y: 0, width: 0, height: 0 } : 
            { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };       

          return {
            id: index,
            segmentation: maskData, // Store the raw boolean mask
            bbox: bbox,
            area: area,
            // color: getRandomColor() // Optional: assign a random color for display
          };
        }).filter((mask: Mask) => mask.area > 0); // Filter out empty masks

        setSegmentedMasks(processedMasks);
        if (processedMasks.length === 0) {
            setError("SAM returned masks, but they were all empty after processing");
        }
      } else {
        setError("No masks returned from SAM or an error occurred.");
        setSegmentedMasks([]);
      }

    } catch (err) {
      console.error('Segmentation error:', err);
      handleApiError(err, 'segmentation');
      setSegmentedMasks([]);
    } finally {
      setIsSegmenting(false);
    }
  };

  const handleApiError = (err: any, type: 'upload' | 'segmentation') => {
    if (axios.isAxiosError(err) && err.response) {
      setError(`Error (${type}): ${err.response.status} - ${err.response.data.detail || err.message}`);
    } else if (err instanceof Error) {
      setError(`Error (${type}): ${err.message}`);
    } else {
      setError(`An unexpected ${type} error occurred.`);
    }
  };
  
  // Draw masks on canvas
  useEffect(() => {
    if (segmentedMasks.length > 0 && canvasRef.current && uploadedImageUrl) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.src = uploadedImageUrl;
      img.onload = () => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx?.clearRect(0,0, canvas.width, canvas.height); // Clear previous drawings
        // ctx?.drawImage(img, 0, 0); // Draw base image if needed, or assume CSS background

        segmentedMasks.forEach(mask => {
          if (!ctx) return;
          // Create a temporary canvas to draw the individual mask
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = img.naturalWidth;
          tempCanvas.height = img.naturalHeight;
          const tempCtx = tempCanvas.getContext('2d');
          if (!tempCtx) return;

          const maskImageData = tempCtx.createImageData(img.naturalWidth, img.naturalHeight);
          const data = maskImageData.data;
          const maskColor = hexToRgba(mask.color || selectedColor, 0.5); // Use mask specific or selected color

          for (let r = 0; r < img.naturalHeight; r++) {
            for (let c = 0; c < img.naturalWidth; c++) {
              const index = (r * img.naturalWidth + c) * 4;
              if (mask.segmentation[r] && mask.segmentation[r][c]) {
                data[index] = maskColor.r;     // R
                data[index + 1] = maskColor.g; // G
                data[index + 2] = maskColor.b; // B
                data[index + 3] = maskColor.a; // A (alpha)
              }
            }
          }
          tempCtx.putImageData(maskImageData, 0, 0);
          ctx.drawImage(tempCanvas, 0, 0); // Draw this mask onto the main canvas
        });
      };
      img.onerror = () => {
        setError("Failed to load image onto canvas for drawing masks.");
      };
    } else if (canvasRef.current && !uploadedImageUrl) {
        // Clear canvas if no image is uploaded
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [segmentedMasks, uploadedImageUrl, selectedColor]);

  const handleRecolorMask = (maskId: number) => {
    console.log(`Attempting to recolor mask ${maskId} with ${selectedColor}`);
    // Placeholder for actual recoloring logic
    // This will involve sending the mask data (or identifier) and target color to a new backend endpoint
    alert(`TODO: Implement recoloring for mask ${maskId} with color ${selectedColor}.\nThis will call a new backend endpoint.`);
    // Example: Update the color of the mask in the state to trigger a re-render by useEffect
    setSegmentedMasks(prevMasks => 
        prevMasks.map(m => m.id === maskId ? {...m, color: selectedColor} : m)
    );
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

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-4 md:p-8">
      <header className="w-full max-w-4xl mb-8 md:mb-12 text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-500 to-red-500">
          Gunpla Interactive Colorizer
        </h1>
        <p className="text-lg md:text-xl text-gray-300 mt-3 md:mt-4">
          Upload image, click a part, pick a color, and see it transform!
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
                disabled={isLoading || isSegmenting}
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
            {uploadedImageUrl && !isSegmenting && <p className="text-center text-sm text-green-400">Image uploaded! Click on the image to select a part.</p>}
            {isSegmenting && <p className="text-center text-sm text-yellow-400">Segmenting part... please wait.</p>} 

            {error && <p className="text-red-400 bg-red-900 bg-opacity-30 p-3 rounded-md text-sm">{error}</p>}
            
            {segmentedMasks.length > 0 && (
              <div className="mt-6 space-y-3">
                <div>
                  <label htmlFor="colorPicker" className="block text-md font-medium text-gray-300 mb-1">Recolor With:</label>
                  <input 
                    type="color" 
                    id="colorPicker"
                    value={selectedColor}
                    onChange={handleColorChange}
                    className="w-full h-10 p-1 bg-gray-700 border border-gray-600 rounded-lg cursor-pointer"
                  />
                </div>
                <p className="text-sm text-gray-400">Select a mask below to apply the chosen color.</p>
                <div className="max-h-48 overflow-y-auto space-y-2 pr-2">
                    {segmentedMasks.map((mask) => (
                        <button 
                            key={mask.id} 
                            onClick={() => handleRecolorMask(mask.id)}
                            className="w-full text-left p-2 rounded-md hover:bg-purple-700 bg-gray-700 border border-gray-600 transition-colors duration-150 text-sm"
                            style={{borderColor: mask.color || 'transparent'}}
                        >
                           Mask {mask.id + 1} (Area: {mask.area}px)
                        </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Image Display and Interaction Area */} 
          <div 
            ref={imageDisplayRef} 
            className="relative w-full aspect-[4/3] bg-gray-700 rounded-lg overflow-hidden flex justify-center items-center cursor-crosshair"
            onClick={uploadedImageUrl && !isSegmenting ? handleImageClick : undefined} // Only allow click if image is loaded and not currently segmenting
          >
            {uploadedImageUrl ? (
              <img 
                src={uploadedImageUrl} 
                alt="Uploaded Gunpla" 
                className="max-h-full max-w-full object-contain select-none" // select-none to prevent dragging image
              />
            ) : (
              <p className="text-gray-500">Image will appear here after upload.</p>
            )}
            {/* Canvas for drawing masks */} 
            <canvas 
                ref={canvasRef} 
                className="absolute top-0 left-0 w-full h-full pointer-events-none" 
            />
            {(isLoading || isSegmenting) && (
                <div className="absolute inset-0 bg-gray-800 bg-opacity-75 flex flex-col justify-center items-center">
                    <svg className="animate-spin h-10 w-10 text-purple-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="mt-2 text-lg">{isLoading ? 'Uploading...' : 'Segmenting...'}</p>
                </div>
            )}
            {clickPoint && (
                <div 
                    className="absolute rounded-full w-3 h-3 bg-red-500 border-2 border-white pointer-events-none transform -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${(clickPoint.x / (canvasRef.current?.width || 1)) * 100}%`, top: `${(clickPoint.y / (canvasRef.current?.height || 1)) * 100}%` }}
                />
            )}
          </div>
        </div>
      </main>

      <footer className="w-full max-w-5xl mt-8 md:mt-12 text-center text-gray-500 text-sm">
        <p>&copy; {new Date().getFullYear()} Gunpla Colorizer. </p>
      </footer>
    </div>
  );
} 