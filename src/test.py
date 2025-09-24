import pytesseract
from PIL import Image
import os

# Double-check that this path exists
custom_path = r"C:\Users\ranju\AppData\Local\Programs\Tesseract-OCR\tesseract.exe"

# Safety check — this should print True
print("Path exists:", os.path.exists(custom_path))

# Now assign the path
pytesseract.tesseract_cmd = custom_path

# Load image
image_path = r"data\medicine.jpeg"
print("Image exists:", os.path.exists(image_path))
image = Image.open(image_path)

# OCR it
text = pytesseract.image_to_string(image)
print("OCR result:\n", text)
