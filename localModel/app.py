import os
import torch
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from PIL import Image
import io
import math
import re
from transformers import Qwen2VLForConditionalGeneration, AutoProcessor
from qwen_vl_utils import process_vision_info
from typing import List, Dict, Any, Optional

# Import UI-TARS parser functions
from ui_tars.action_parser import parse_action_to_structure_output, parsing_response_to_pyautogui_code

# Define the prompt template directly here to avoid dependency issues if ui_tars is not in pythonpath for some reason, 
# but since we installed it, we could import. However, copying ensures we have control as requested.
COMPUTER_USE_TEMPLATE = """You are a GUI agent. You are given a task and your action history, with screenshots. You need to perform the next action to complete the task.

## Output Format
```
Thought: ...
Action: ...
```

## Action Space

click(point='<point>x1 y1</point>')
left_double(point='<point>x1 y1</point>')
right_single(point='<point>x1 y1</point>')
drag(start_point='<point>x1 y1</point>', end_point='<point>x2 y2</point>')
hotkey(key='ctrl c') # Split keys with a space and use lowercase. Also, do not use more than 3 keys in one hotkey action.
type(content='xxx') # Use escape characters \\', \\", and \\n in content part to ensure we can parse the content in normal python string format. If you want to submit your input, use \\n at the end of content. 
scroll(point='<point>x1 y1</point>', direction='down or up or right or left') # Show more information on the `direction` side.
wait() #Sleep for 5s and take a screenshot to check for any changes.
finished(content='xxx') # Use escape characters \\', \\", and \\n in content part to ensure we can parse the content in normal python string format.


## Note
- Use English in `Thought` part.
- Write a small plan and finally summarize your next action (with its target element) in one sentence in `Thought` part.

## User Instruction
{instruction}
"""

app = FastAPI()

# Global model and processor
model = None
processor = None
MODEL_ID = "bytedance-research/UI-TARS-7B-DPO"

# Constants
IMAGE_FACTOR = 28
MIN_PIXELS = 100 * 28 * 28
MAX_PIXELS = 16384 * 28 * 28
MAX_RATIO = 200

def round_by_factor(number: int, factor: int) -> int:
    return round(number / factor) * factor

def ceil_by_factor(number: int, factor: int) -> int:
    return math.ceil(number / factor) * factor

def floor_by_factor(number: int, factor: int) -> int:
    return math.floor(number / factor) * factor

def smart_resize(
    height: int, width: int, factor: int = IMAGE_FACTOR, min_pixels: int = MIN_PIXELS, max_pixels: int = MAX_PIXELS
) -> tuple[int, int]:
    if max(height, width) / min(height, width) > MAX_RATIO:
        raise ValueError(
            f"absolute aspect ratio must be smaller than {MAX_RATIO}, got {max(height, width) / min(height, width)}"
        )
    h_bar = max(factor, round_by_factor(height, factor))
    w_bar = max(factor, round_by_factor(width, factor))
    if h_bar * w_bar > max_pixels:
        beta = math.sqrt((height * width) / max_pixels)
        h_bar = floor_by_factor(height / beta, factor)
        w_bar = floor_by_factor(width / beta, factor)
    elif h_bar * w_bar < min_pixels:
        beta = math.sqrt(min_pixels / (height * width))
        h_bar = ceil_by_factor(height * beta, factor)
        w_bar = ceil_by_factor(width * beta, factor)
    return h_bar, w_bar

@app.on_event("startup")
async def load_model():
    global model, processor
    print(f"Loading model: {MODEL_ID}...")
    try:
        # Check if GPU is available
        if torch.cuda.is_available():
            print(f"CUDA is available. Using device: {torch.cuda.get_device_name(0)}")
            device_map = "auto"
            dtype = torch.bfloat16
        else:
            print("CUDA is NOT available. Using CPU.")
            device_map = "cpu"
            dtype = torch.float32
        
        model = Qwen2VLForConditionalGeneration.from_pretrained(
            MODEL_ID,
            torch_dtype=dtype,
            device_map=device_map,
        )
        processor = AutoProcessor.from_pretrained(MODEL_ID)
        print(f"Model loaded successfully on {model.device if hasattr(model, 'device') else 'unknown device'}.")
        print(f"Model memory footprint: {model.get_memory_footprint() / 1024**3:.2f} GB")
    except Exception as e:
        print(f"Error loading model: {e}")
        pass

class CoordinateResponse(BaseModel):
    original_width: int
    original_height: int
    raw_output: str
    parsed_actions: List[Dict[str, Any]]
    pyautogui_code: str
    actual_x: Optional[int] = None
    actual_y: Optional[int] = None

@app.post("/process_image", response_model=CoordinateResponse)
async def process_image(
    instruction: str = Form(...),
    file: UploadFile = File(...)
):
    global model, processor
    if model is None or processor is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    # Read image
    contents = await file.read()
    image = Image.open(io.BytesIO(contents))
    original_width, original_height = image.size

    # Apply Prompt Template
    full_instruction = COMPUTER_USE_TEMPLATE.format(instruction=instruction)

    # Construct messages
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": full_instruction},
            ],
        }
    ]

    # Preprocess
    text = processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    
    image_inputs, video_inputs = process_vision_info(messages)
    
    inputs = processor(
        text=[text],
        images=image_inputs,
        videos=video_inputs,
        padding=True,
        return_tensors="pt",
    )
    
    if torch.cuda.is_available():
        inputs = inputs.to("cuda")
        print('cuda available')

    # Inference
    generated_ids = model.generate(
        **inputs,
        max_new_tokens=128,
        do_sample=False, 
    )

    generated_ids_trimmed = [
        out_ids[len(in_ids) :] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
    ]
    output_text = processor.batch_decode(
        generated_ids_trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False
    )[0]

    print(f"Raw output: {output_text}")

    # Use UI-TARS parser
    # Note: parse_action_to_structure_output expects 'origin_resized_height'/'origin_resized_width'
    # Based on user snippet, we pass original dimensions.
    try:
        parsed_actions = parse_action_to_structure_output(
            output_text,
            factor=1000,
            origin_resized_height=original_height,
            origin_resized_width=original_width,
            model_type="qwen25vl"
        )
        
        # Generate PyAutoGUI code
        pyautogui_code = parsing_response_to_pyautogui_code(
            responses=parsed_actions,
            image_height=original_height,
            image_width=original_width,
            scale_factor=1
        )

    except Exception as e:
        print(f"Parsing error: {e}")
        parsed_actions = []
        pyautogui_code = f"# Error parsing actions: {e}"

    # Extract coordinates for compatibility with test script if available
    actual_x = None
    actual_y = None
    print(f"Parsed actions: {parsed_actions} , {pyautogui_code}")
    if parsed_actions:
        first_action = parsed_actions[0]
        inputs = first_action.get("action_inputs", {})
        if "start_box" in inputs:
            # start_box is usually a string representation of list like "[0.123, 0.456, 0.123, 0.456]" (normalized)
            # OR absolute coords if that's what the parser produces for qwen25vl.
            # Let's inspect what the parser produces.
            # In action_parser.py: 
            # if model_type == "qwen25vl":
            #   float_numbers.append(float(num / smart_resize_height)) ...
            # So it produces NORMALIZED coordinates (0-1).
            
            try:
                # The parser returns a string representation of list in 'start_box' like "[0.1, 0.2, 0.1, 0.2]"
                box = eval(inputs["start_box"])
                if isinstance(box, list) and len(box) >= 2:
                    # Calculate center
                    center_x = (box[0] + box[2]) / 2 if len(box) >= 4 else box[0]
                    center_y = (box[1] + box[3]) / 2 if len(box) >= 4 else box[1]
                    
                    actual_x = int(center_x * original_width)
                    actual_y = int(center_y * original_height)
            except:
                pass

    return CoordinateResponse(
        original_width=original_width,
        original_height=original_height,
        raw_output=output_text,
        parsed_actions=parsed_actions,
        pyautogui_code=pyautogui_code,
        actual_x=actual_x,
        actual_y=actual_y
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
