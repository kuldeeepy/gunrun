# Pixel-art plush character (classic version):
# one capsule body (hood flows into body, no neck), face inside a hood opening, beady eyes,
# pink blush, tiny smile, mitten arms at the sides, short stumpy legs, knit texture.
# Frames are 50x50 with feet on the bottom row, facing right.
from PIL import Image, ImageDraw

OUT = 'raw/muse/'
LINE = (92, 74, 60, 255)
FUR = (238, 226, 204, 255); FUR_SH = (214, 199, 173, 255); FUR_DK = (190, 173, 146, 255)
FACE = (246, 236, 220, 255); EYE = (24, 20, 22, 255); BLUSH = (240, 158, 160, 255)

def knit(d, box, color, step=3):
    # sparse offset specks read as knitted plush at this size
    x0, y0, x1, y1 = box
    for y in range(y0, y1, step):
        for x in range(x0 + (y // step) % 2, x1, step * 2):
            d.point((x, y), fill=color)

def mitten(d, x0, y0, x1, y1, shade=False):
    d.rounded_rectangle((x0, y0, x1, y1), radius=3, fill=LINE)
    d.rounded_rectangle((x0 + 1, y0 + 1, x1 - 1, y1 - 1), radius=2, fill=FUR_SH if shade else FUR)

def plush(pose='stand', step=0, hurt=False, blink=False):
    im = Image.new('RGBA', (50, 50)); d = ImageDraw.Draw(im)
    bob = 1 if pose == 'run' and step % 2 else 0
    tuck = pose == 'jump'
    top = 3 + bob - (2 if tuck else 0)
    bottom = 43 + bob - (4 if tuck else 0)

    # back arm (behind body, shaded)
    mitten(d, 9, top + 21, 16, top + 34 - (4 if tuck else 0), shade=True)

    # legs: two stumps; run alternates which one lifts
    lift = (2 if step in (1, 2) else 0) if pose == 'run' else 0
    for i, lx in enumerate((15, 26)):
        ly = bottom + (-lift if (i == 0) == (step < 2) else 0) - (3 if tuck else 0)
        d.rounded_rectangle((lx, ly - 5, lx + 9, ly + 6 - bob), radius=3, fill=LINE)
        d.rounded_rectangle((lx + 1, ly - 4, lx + 8, ly + 5 - bob), radius=2, fill=FUR_SH)

    # capsule body: round dome on top, softer corners at the bottom
    d.rounded_rectangle((11, top, 39, bottom), radius=13, fill=LINE)
    d.rounded_rectangle((12, top + 1, 38, bottom - 1), radius=12, fill=FUR)
    d.rounded_rectangle((30, top + 8, 38, bottom - 1), radius=8, fill=FUR_SH)      # right-side shading
    d.rounded_rectangle((12, top + 1, 34, bottom - 3), radius=12, fill=FUR)
    knit(d, (14, top + 3, 37, bottom - 2), (228, 215, 190, 255))
    d.ellipse((15, top + 3, 21, top + 7), fill=(250, 244, 232, 255))              # dome highlight

    # hood opening framing the face
    fx0, fy0, fx1, fy1 = 18, top + 8, 37, top + 24
    d.rounded_rectangle((fx0 - 1, fy0 - 1, fx1 + 1, fy1 + 1), radius=7, fill=FUR_SH)
    d.rounded_rectangle((fx0, fy0, fx1, fy1), radius=6, fill=FACE)

    # face (shifted toward facing direction)
    cy = top + 16
    for ex in (23, 31):
        if hurt:
            d.line((ex - 1, cy - 1, ex + 1, cy + 1), fill=EYE); d.line((ex - 1, cy + 1, ex + 1, cy - 1), fill=EYE)
        elif blink:
            d.line((ex - 1, cy, ex + 1, cy), fill=EYE)
        else:
            d.rectangle((ex - 1, cy - 1, ex, cy + 1), fill=EYE)
    d.rectangle((19, cy + 3, 21, cy + 4), fill=BLUSH)
    d.rectangle((33, cy + 3, 35, cy + 4), fill=BLUSH)
    if hurt: d.line((26, cy + 5, 28, cy + 5), fill=EYE)
    else:
        d.point((26, cy + 4), fill=EYE); d.point((27, cy + 5), fill=EYE); d.point((28, cy + 4), fill=EYE)

    # front mitten arm reaching forward to hold the blaster
    ay = top + 26 - (2 if tuck else 0)
    mitten(d, 28, ay, 39, ay + 7)
    return im

def prone():
    # lying on its tummy, head forward (right), capsule on its side
    im = Image.new('RGBA', (70, 50)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((6, 33, 60, 50), radius=8, fill=LINE)
    d.rounded_rectangle((7, 34, 59, 49), radius=7, fill=FUR)
    knit(d, (9, 36, 57, 48), (228, 215, 190, 255))
    d.rounded_rectangle((40, 35, 58, 48), radius=6, fill=FUR_DK)
    d.rounded_rectangle((41, 36, 57, 47), radius=5, fill=FACE)
    for ex in (46, 53): d.rectangle((ex - 1, 39, ex, 41), fill=EYE)
    d.rectangle((43, 43, 44, 44), fill=BLUSH); d.rectangle((55, 43, 56, 44), fill=BLUSH)
    d.point((49, 44), fill=EYE); d.point((50, 45), fill=EYE); d.point((51, 44), fill=EYE)
    return im

def blaster():
    # chunky toy blaster, 24x9, muzzle on the right edge, blue
    im = Image.new('RGBA', (24, 9)); d = ImageDraw.Draw(im)
    d.rectangle((0, 1, 17, 7), fill=LINE)
    d.rectangle((1, 2, 16, 6), fill=(70, 120, 235, 255))
    d.rectangle((1, 2, 16, 3), fill=(140, 180, 255, 255))
    d.rectangle((16, 2, 23, 5), fill=LINE); d.rectangle((17, 3, 22, 4), fill=(200, 205, 215, 255))
    d.rectangle((4, 6, 7, 8), fill=LINE)
    return im

frames = {'muse_stand': plush(), 'muse_blink': plush(blink=True), 'muse_jump': plush('jump'),
          'muse_hurt': plush(hurt=True), 'muse_prone': prone(), 'muse_gun': blaster()}
for i in range(4): frames[f'muse_run{i}'] = plush('run', i)
for n, im in frames.items(): im.save(OUT + n + '.png')
print(len(frames), 'muse frames')
