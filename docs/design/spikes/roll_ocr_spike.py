# Throwaway spike (#92): OCR accuracy on one image-only Telangana roll PDF.
# Kept only as a reference for the roll-parser worker; not production code.
# Usage: python roll_ocr_spike.py <roll.pdf>  (needs pymupdf, opencv-python-headless, pytesseract, tesseract 5)

import re, sys, json, time
import cv2, numpy as np, pymupdf, pytesseract

def page_image(doc, i, zoom=2.0):
    pix = doc[i].get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csGRAY)
    return np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w)

def find_boxes(img):
    # voter boxes: large rectangles ~1/3 page wide
    h, w = img.shape
    bw = cv2.adaptiveThreshold(img, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 15, 10)
    cnts, _ = cv2.findContours(bw, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for c in cnts:
        x, y, bw_, bh = cv2.boundingRect(c)
        if 0.28*w < bw_ < 0.34*w and 0.07*h < bh < 0.11*h:
            boxes.append((x, y, bw_, bh))
    # dedupe (inner/outer borders)
    boxes.sort(key=lambda b: (b[1]//40, b[0]))
    out = []
    for b in boxes:
        if not any(abs(b[0]-o[0]) < 20 and abs(b[1]-o[1]) < 20 for o in out):
            out.append(b)
    out.sort(key=lambda b: (round(b[1]/50), b[0]))
    return out

TO_LETTER = str.maketrans({'1': 'I', '0': 'O', '5': 'S', '8': 'B', '2': 'Z', '6': 'G', '|': 'I'})
TO_DIGIT = str.maketrans({'O': '0', 'I': '1', 'L': '1', 'S': '5', 'B': '8', 'Z': '2', 'G': '6', 'Q': '0', 'D': '0'})
def normalise_epic(t):
    t = re.sub(r'[^A-Z0-9|]', '', t.upper())
    for i in range(len(t) - 9):
        cand = t[i:i+3].translate(TO_LETTER) + t[i+3:i+10].translate(TO_DIGIT)
        if re.fullmatch(r'[A-Z]{3}\d{7}', cand):
            return cand
    return None

def inner_box(strip):
    # crop inside the small bordered serial box, then enlarge for OCR
    bw = cv2.threshold(strip, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    cnts, _ = cv2.findContours(bw, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    best = None
    for c in cnts:
        x, y, w, h = cv2.boundingRect(c)
        if w > strip.shape[1] * 0.5 and h > strip.shape[0] * 0.4:
            if best is None or w * h < best[2] * best[3]:
                best = (x, y, w, h)
    if best:
        x, y, w, h = best
        strip = strip[y+5:y+h-5, x+5:x+w-5]
    strip = cv2.resize(strip, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    return cv2.copyMakeBorder(strip, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)

REL = r'(Fathers|Husbands|Mothers|Wifes|Others|Guardians)\s*Name|Others'
def parse_box(img, b):
    x, y, w, h = b
    crop = img[y+4:y+h-4, x+4:x+w-4]
    # blank out the photo placeholder (right ~26% of the box, below the top line)
    txt_area = crop.copy()
    txt_area[int(h*0.2):, int(w*0.73):] = 255
    # top strip: serial (centre box) and EPIC (right); body: the text fields
    top = crop[:int(h*0.17), :]
    body = txt_area[int(h*0.17):, :]
    serial_img = top[:, int(w*0.02):int(w*0.40)]
    epic_img = top[:, int(w*0.55):]
    serial_txt = pytesseract.image_to_string(inner_box(serial_img), config='--psm 7 -c tessedit_char_whitelist=0123456789')
    epic_txt = pytesseract.image_to_string(epic_img, config='--psm 7 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/')
    text = pytesseract.image_to_string(body, config='--psm 6')
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    full = '\n'.join(lines)
    rec = {'raw': full, 'raw_serial': serial_txt.strip(), 'raw_epic': epic_txt.strip()}
    rec['epic'] = normalise_epic(epic_txt)
    m = re.search(r'(\d{1,4})', serial_txt)
    rec['serial'] = int(m.group(1)) if m else None
    joined = ' '.join(lines)
    m = re.search(r'^\W*Name\s*[:;=+]+\s*(.*?)\s*(?:Fathers|Husbands|Mothers|Wifes|Others|Guardians)', joined)
    rec['name'] = m.group(1).strip() if m else None
    m = re.search(r'(Fathers|Husbands|Mothers|Wifes|Others|Guardians)\s*(?:Name)?\s*[:;]\s*(.*?)\s*House\s*Number', joined)
    rec['relation'] = m.group(1) if m else None
    rec['relative'] = m.group(2).strip() if m else None
    m = re.search(r'House\s*Number\s*[:;]\s*(.*?)\s*Age\s*[:;]', joined)
    rec['house'] = m.group(1).strip() if m else None
    m = re.search(r'Age\s*[:;]\s*(\d{2,3})', joined)
    rec['age'] = int(m.group(1)) if m else None
    m = re.search(r'Gender\s*[:;]\s*(Male|Female|Third\s*Gender)', joined)
    rec['gender'] = m.group(1) if m else None
    return rec

doc = pymupdf.open(sys.argv[1])
t0 = time.time()
rows = []
for i in range(2, doc.page_count - 1):
    img = page_image(doc, i)
    boxes = find_boxes(img)
    for b in boxes:
        r = parse_box(img, b); r['page'] = i+1; rows.append(r)
print(f'pages {doc.page_count-3}, boxes {len(rows)}, seconds {time.time()-t0:.1f}')
json.dump(rows, open('rows.json', 'w'), indent=1)
