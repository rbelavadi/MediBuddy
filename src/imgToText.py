import pytesseract
from PIL import Image
import os
import cv2
import numpy as np

class OCR:
    def __init__(self):
        self.tesseract_dir = r"C:\Program Files\Tesseract-OCR"
        self.tesseract_exe = os.path.join(self.tesseract_dir, "tesseract.exe")
        os.environ["PATH"] += os.pathsep + self.tesseract_dir

    def extract(self, image_path: str) -> str:
        try:
            image = self.preprocess_image(image_path)
            pytesseract.tesseract_cmd = self.tesseract_exe
            text = pytesseract.image_to_string(image, lang="eng")
            print("Extracted text:", repr(text))
            if not text:
                return "Couldn't read the image."
            return text
        except Exception as e:
            print(e)
            return "Error"
        
    def preprocess_image(self, image_path: str) -> np.ndarray:
        # Load image
        image = cv2.imread(image_path)

        # Convert to grayscale
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        # Resize
        gray = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_LINEAR)

        # Apply thresholding
        _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        # Optional: Denoising
        thresh = cv2.medianBlur(thresh, 3)

        return thresh

ocr = OCR()
text = ocr.extract("data\levothyroxine-sodium-prescription-bottle-levothyroxine-is-a-generic-HDE309.jpg")
print(text)