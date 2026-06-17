from PIL import Image
import sys

def trim_transparent(image_path):
    try:
        img = Image.open(image_path)
        img = img.convert("RGBA")
        bbox = img.getbbox()
        if bbox:
            trimmed = img.crop(bbox)
            trimmed.save(image_path)
            print(f"Trimmed {image_path} from {img.size} to {trimmed.size} (bbox: {bbox})")
        else:
            print(f"Image {image_path} is empty")
    except Exception as e:
        print(f"Error processing {image_path}: {e}")

trim_transparent('/Users/huangyihe/International College Admissions  System/frontend/public/wyu/logo-iec.png')
trim_transparent('/Users/huangyihe/International College Admissions  System/frontend/public/wyu/logo-wuyi.png')
