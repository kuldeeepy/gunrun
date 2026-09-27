# Find 1px white-bordered frame boxes in an Open Gunner sheet.
import sys, json
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGBA'); W, H = im.size; px = im.load()
white = lambda x, y: 0 <= x < W and 0 <= y < H and px[x, y][:3] == (255, 255, 255)
boxes = []
for y in range(H - 1):
    for x in range(W - 1):
        if not (white(x, y) and white(x + 1, y) and white(x, y + 1)): continue
        x2 = x + 1
        while x2 < W and white(x2, y) and not white(x2, y + 1): x2 += 1
        y2 = y + 1
        while y2 < H and white(x, y2) and not white(x + 1, y2): y2 += 1
        if x2 - x < 12 or y2 - y < 12 or x2 >= W or y2 >= H: continue
        if all(white(i, y2) for i in range(x, x2 + 1)) and all(white(x2, j) for j in range(y, y2 + 1)):
            boxes.append((x + 1, y + 1, x2 - x - 1, y2 - y - 1))
print(json.dumps(boxes))
