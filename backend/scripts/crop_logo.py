import sys
from PIL import Image

def process_logo(input_path, output_path):
    # Open image
    img = Image.open(input_path).convert("RGBA")
    
    # Make white transparent
    datas = img.getdata()
    newData = []
    for item in datas:
        # If it's pure white (or close) -> transparent
        if item[0] > 240 and item[1] > 240 and item[2] > 240:
            newData.append((255, 255, 255, 0))
        else:
            newData.append(item)
    img.putdata(newData)
    
    # Get bounding box of non-transparent areas
    bbox = img.getbbox()
    if bbox:
        # Crop to bounding box
        img = img.crop(bbox)
        
    # Save optimized and cropped logo
    img.save(output_path, "PNG")
    print(f"Processed and cropped logo saved to {output_path}")

if __name__ == "__main__":
    input_file = '/root/.gemini/antigravity/brain/d21cb4c1-ff0e-4116-b147-096dafe48ff2/media__1776360667686.png'
    output_file = '/root/workspace-saas/frontend/public/logo-golden.png'
    process_logo(input_file, output_file)
