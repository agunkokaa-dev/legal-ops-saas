from PIL import Image

def make_transparent(img):
    img = img.convert("RGBA")
    datas = img.getdata()
    
    newData = []
    # Tolerance for white background
    for item in datas:
        # Check if the pixel is white (or very close to it)
        if item[0] > 240 and item[1] > 240 and item[2] > 240:
            # changing to transparent
            newData.append((255, 255, 255, 0))
        else:
            newData.append(item)
            
    img.putdata(newData)
    return img

def main():
    try:
        source_path = '/root/.gemini/antigravity/brain/d21cb4c1-ff0e-4116-b147-096dafe48ff2/media__1776359976504.png'
        print(f"Opening {source_path}...")
        img = Image.open(source_path)
        
        # Crop square if not square
        width, height = img.size
        if width != height:
            size = min(width, height)
            left = (width - size) // 2
            top = (height - size) // 2
            right = (width + size) // 2
            bottom = (height + size) // 2
            img = img.crop((left, top, right, bottom))
            
        print("Making transparent...")
        transparent_img = make_transparent(img)
        
        out_dir = '/root/workspace-saas/frontend/app'
        
        # Next.js app router generally uses icon.png (any size, often 512x512)
        # favicon.ico (any size, typically 32x32)
        # apple-icon.png (180x180)
        
        icon_png = transparent_img.resize((512, 512), Image.Resampling.LANCZOS)
        icon_png.save(f"{out_dir}/icon.png", "PNG")
        print("Saved icon.png")
        
        # Favicon.ico
        favicon = transparent_img.resize((32, 32), Image.Resampling.LANCZOS)
        favicon.save(f"{out_dir}/favicon.ico", "ICO")
        print("Saved favicon.ico")
        
        # Apple touch icon
        apple_icon = transparent_img.resize((180, 180), Image.Resampling.LANCZOS)
        apple_icon.save(f"{out_dir}/apple-icon.png", "PNG")
        print("Saved apple-icon.png")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
