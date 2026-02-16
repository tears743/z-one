import requests
import json
from PIL import Image, ImageDraw
import io
import time

def test_process_image():
    url = "http://127.0.0.1:8000/process_image"
    image_path = "new.png"
    instruction = "找到微信中的T好友"
    
    print(f"Sending request to {url} with image {image_path} and instruction: {instruction}")
    
    # Retry logic for connection
    max_retries = 3
    for attempt in range(max_retries):
        try:
            with open(image_path, "rb") as f:
                files = {"file": f}
                data = {"instruction": instruction}
                response = requests.post(url, files=files, data=data)
            
            if response.status_code == 200:
                break
            else:
                print(f"Attempt {attempt+1} failed with status {response.status_code}: {response.text}")
        except requests.exceptions.ConnectionError:
            print(f"Attempt {attempt+1}: Could not connect to server. Retrying in 2s...")
            time.sleep(2)
        except Exception as e:
            print(f"An error occurred: {e}")
            return

    if 'response' not in locals() or response.status_code != 200:
        print("Failed to get a valid response from server.")
        return

    result = response.json()
    print("\nResponse:")
    print(json.dumps(result, indent=2))
    
    # Annotate image
    try:
        original_image = Image.open(image_path)
        draw = ImageDraw.Draw(original_image)
        
        x = result.get('actual_x')
        y = result.get('actual_y')
        
        if x is not None and y is not None:
            if x == 0 and y == 0:
                print("Warning: Coordinates are (0,0).")

            # Draw a red circle at the point
            radius = 20
            # Draw circle
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline="red", width=5)
            # Draw crosshair
            draw.line((x - radius, y, x + radius, y), fill="red", width=3)
            draw.line((x, y - radius, x, y + radius), fill="red", width=3)
            
            output_path = "annotated_result.png"
            original_image.save(output_path)
            print(f"\nAnnotated image saved to {output_path}")
        else:
            print("\nNo coordinates found to annotate (Action might not be a click or drag).")
            
    except Exception as e:
        print(f"Error processing image: {e}")

if __name__ == "__main__":
    test_process_image()
