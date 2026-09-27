# Cut Open Gunner sheets (CC-BY 3.0, Master484) into one atlas for Phaser.
# Run: python3 tools/pack.py
import json, subprocess
from PIL import Image

RAW = 'raw/'
BG = (77, 75, 118)
def boxes(sheet):
    return json.loads(subprocess.check_output(['python3', 'tools/boxes.py', RAW + sheet]))

frames = {}  # name -> Image
def cut(sheet, rect, name):
    im = Image.open(RAW + sheet).convert('RGBA')
    x, y, w, h = rect
    fr = im.crop((x, y, x + w, y + h))
    px = fr.load()
    for j in range(h):
        for i in range(w):
            if px[i, j][:3] == BG: px[i, j] = (0, 0, 0, 0)
    frames[name] = fr

hb = boxes('OpenGunnerHeroVer2.png')
for n, i in dict(stand=5, jump=7, hurt=8, prone=35, aimUD=50, aimU=51, aimDD=58, aimD=60).items():
    cut('OpenGunnerHeroVer2.png', hb[i], 'hero_' + n)
for k in range(8):
    cut('OpenGunnerHeroVer2.png', hb[17 + k], f'hero_run{k}')
    cut('OpenGunnerHeroVer2.png', hb[68 + k], f'hero_runU{k}')
    cut('OpenGunnerHeroVer2.png', hb[76 + k], f'hero_runD{k}')

sb = boxes('OpenGunnerEnemySoldier.png')
for n, i in dict(stand=0, jump=2, hurt=3).items():
    cut('OpenGunnerEnemySoldier.png', sb[i], 'sol_' + n)
for k in range(8):
    cut('OpenGunnerEnemySoldier.png', sb[8 + k], f'sol_run{k}')

eb = boxes('OpenGunnerEnemies.png')
for n, i in dict(tur1=1, tur1s=2, tur2=5, tur2s0=7, tur2s1=8, carrier0=17, carrier1=18, drone0=19, drone1=20).items():
    cut('OpenGunnerEnemies.png', eb[i], n)

mb = boxes('OpenGunnerMechs.png')
for n, i in dict(mech_stand=1, mech_shoot0=3, mech_shoot1=4, mech_jump=7).items():
    cut('OpenGunnerMechs.png', mb[i], n)

ob = boxes('OpenGunnerMiscObjects.png')
cut('OpenGunnerMiscObjects.png', ob[35], 'lift')
cut('OpenGunnerMiscObjects.png', ob[56], 'spikes')

# Power-up orbs: red-letter column (3rd), rows A B C F P.
for n, y in dict(A=228, B=250, C=272, F=294, P=316).items():
    cut('OpenGunnerMiscObjects.png', (97, y - 3, 19, 19), 'orb_' + n)

tiles = 'OpenGunnerStarterTiles.png'
names = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br']
for k, n in enumerate(names):
    cut(tiles, ([21, 75, 129][k % 3], [206, 260, 314][k // 3], 50, 50), 'wall_' + n)
    cut(tiles, ([21, 75, 129][k % 3], [373, 427, 481][k // 3], 50, 50), 'wallg_' + n)
for k, n in enumerate(['plain', 'vent', 'panel', 'pillar', 'slat']):
    cut(tiles, (380 + 54 * k, 206, 50, 50), 'bg_' + n)
    cut(tiles, (380 + 54 * k, 373, 50, 50), 'bgg_' + n)
for k in range(4):
    cut(tiles, (434 + 54 * k, 260, 50, 50), f'bg_lights{k}')

# Palette-swapped heroes: armour blues (hue ~200-235) and red accents get new hues.
import colorsys
SKINS = {  # prefix: (armour hue, armour sat mult, accent hue)
    'hero1_': (352, 1.0, 45),    # BLAZE: crimson + gold
    'hero2_': (275, 1.0, 185),   # VIPER: violet + cyan
    'hero3_': (215, 0.12, 25),   # GHOST: white-grey + orange
}
def recolor(fr, armour_h, sat_mult, accent_h):
    out = fr.copy(); px = out.load()
    for j in range(out.height):
        for i in range(out.width):
            r, g, b, a = px[i, j]
            if not a: continue
            h, s_, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255); deg = h * 360
            if 195 <= deg <= 240 and s_ > 0.3: h, s_ = armour_h / 360, min(1, s_ * sat_mult)
            elif (deg >= 350 or deg <= 12) and s_ > 0.5: h = accent_h / 360
            else: continue
            nr, ng, nb = colorsys.hsv_to_rgb(h, s_, v)
            px[i, j] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
    return out
for name in [n for n in frames if n.startswith('hero_')]:
    for prefix, cfg in SKINS.items():
        frames[prefix + name[5:]] = recolor(frames[name], *cfg)

# Hand-drawn plush character frames (tools/muse.py).
import glob, os
for f in glob.glob(RAW + 'muse/*.png'):
    frames[os.path.basename(f)[:-4]] = Image.open(f).convert('RGBA')

# Shelf pack.
PAD = 2; W = 1024
order = sorted(frames, key=lambda n: -frames[n].height)
x = y = rowh = 0; pos = {}
for n in order:
    fw, fh = frames[n].size
    if x + fw + PAD > W: x = 0; y += rowh + PAD; rowh = 0
    pos[n] = (x, y); x += fw + PAD; rowh = max(rowh, fh)
H = y + rowh
atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
out = {'frames': {}, 'meta': {'image': 'atlas.png', 'size': {'w': W, 'h': H}, 'scale': '1'}}
for n, (fx, fy) in pos.items():
    atlas.paste(frames[n], (fx, fy))
    fw, fh = frames[n].size
    out['frames'][n] = {'frame': {'x': fx, 'y': fy, 'w': fw, 'h': fh}, 'rotated': False, 'trimmed': False,
                        'spriteSourceSize': {'x': 0, 'y': 0, 'w': fw, 'h': fh}, 'sourceSize': {'w': fw, 'h': fh}}
atlas.save('public/assets/atlas.png')
json.dump(out, open('public/assets/atlas.json', 'w'))
print(len(frames), 'frames ->', W, 'x', H)
