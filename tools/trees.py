# Assemble full trees from the OPP jungle tree kit (CC0): trunk + canopy blobs + leaf clumps.
from PIL import Image
for src, out in [('tile_jungle_tree_dark', 'tree_a'), ('tile_jungle_tree_light', 'tree_b')]:
    im = Image.open(f'public/assets/jungle/{src}.png').convert('RGBA')
    crop = lambda b: im.crop(b)
    trunk = crop((0, 99, 256, 352))
    trunk.paste((0, 0, 0, 0), (185, 85, 256, 253))  # drop loose clumps that share the trunk's bbox
    blob = crop((235, 9, 308, 89)).resize((146, 160), Image.NEAREST)      # dark canopy mass
    blob2 = crop((75, 9, 148, 89)).resize((146, 160), Image.NEAREST)      # cooler canopy mass
    clumpA = crop((192, 192, 256, 256)); clumpB = crop((213, 274, 274, 331)); clumpC = crop((267, 169, 301, 200))
    W, H = 360, 440
    c = Image.new('RGBA', (W, H))
    put = lambda i, x, y: c.alpha_composite(i, (x, y))
    # back canopy
    for x, y in [(10, 40), (110, 0), (200, 45), (60, 90), (170, 100)]:
        put(blob2 if (x // 10) % 2 else blob, x, y)
    put(trunk, 52, H - trunk.height)
    # front leaf clumps on branch tips and trunk top
    for i, (x, y) in enumerate([(20, 175), (270, 170), (120, 130), (70, 60), (230, 80), (160, 30), (150, 230)]):
        put([clumpA, clumpB, clumpC][i % 3], x, y)
    c = c.crop(c.getbbox())
    c.save(f'public/assets/jungle/{out}.png')
    print(out, c.size)
