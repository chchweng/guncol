# Gunpla Custom Color Recommender

This project is a web application designed to help users easily customize and visualize color schemes for Gunpla (Gundam plastic models). Users can upload an image of their Gunpla, select specific parts, and apply different colors to those parts interactively, with the goal of achieving a realistic preview of the customized model.

## Features

*   **Image Upload:** Users can upload images of their Gunpla models.
*   **Interactive Segmentation:** Users can click on parts of the uploaded image to select them for recoloring. This will be powered by the Segment Anything Model (SAM).
*   **Realistic Recoloring:** Selected parts can be recolored while preserving the original texture and lighting of the image.
*   **Color Palette:** Users can choose colors from a predefined palette or a color picker.

## Tech Stack

**Frontend:**
*   Next.js (React Framework)
*   TypeScript
*   Tailwind CSS

**Backend:**
*   Python
*   FastAPI
*   Segment Anything Model (SAM) via Hugging Face `transformers` or `segment-anything` library
*   Pillow & OpenCV for image manipulation

**Deployment (Planned):**
*   Frontend: Vercel
*   Backend: Hugging Face Spaces / Serverless Functions (e.g., Vercel, AWS Lambda) - TBD based on resource needs.

## Project Structure

```
gunpla-colorizer/
├── frontend/         # Next.js application
├── backend/          # Python FastAPI application
├── .gitignore
└── README.md
```

## Getting Started (Placeholder)

Instructions for setting up and running the project locally will be added here. 