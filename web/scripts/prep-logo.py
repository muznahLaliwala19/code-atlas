from PIL import Image
from pathlib import Path

src = Path(
    r"C:\Users\Alight\.cursor\projects\d-muznah-project\assets"
    r"\c__Users_Alight_AppData_Roaming_Cursor_User_workspaceStorage_"
    r"257c801e85ca94307dabf5648325be3a_images_ChatGPT_Image_Sep_18__2026__"
    r"06_09_30_PM-Photoroom-7f7ea192-d34d-4854-9786-92478d2e88db.png"
)


def knock_out_black(im: Image.Image, threshold: int = 28) -> Image.Image:
    """Make near-black pixels transparent so logo blends on dark green UI."""
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r <= threshold and g <= threshold and b <= threshold:
                px[x, y] = (0, 0, 0, 0)
    return im


img = knock_out_black(Image.open(src))
w, h = img.size
px = img.load()

# Find white vertical divider
best_x, best_score = None, -1
for x in range(int(w * 0.18), int(w * 0.55)):
    bright = 0
    for y in range(int(h * 0.2), int(h * 0.8)):
        r, g, b, a = px[x, y]
        if a > 180 and min(r, g, b) > 210 and abs(r - g) < 20 and abs(g - b) < 20:
            bright += 1
    if bright > best_score:
        best_score = bright
        best_x = x

print("size", w, h, "divider", best_x, best_score)

out_dir = Path(r"d:\muznah\project\web\public")
app_dir = Path(r"d:\muznah\project\web\app")

# Full brand (transparent black removed)
full = out_dir / "brand-logo.png"
# Trim outer empty after knockout
bbox = img.getbbox()
full_img = img.crop(bbox) if bbox else img
full_img.save(full)
print("saved", full, full_img.size)

# Mark only: stop well before divider so line/text are excluded
cut = (best_x or int(w * 0.32)) - 18
cut = max(int(w * 0.2), min(cut, int(w * 0.4)))
mark = img.crop((0, 0, cut, h))
mb = mark.getbbox()
if mb:
    mark = mark.crop(mb)

mw, mh = mark.size
side = max(mw, mh) + 16
sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
sq.paste(mark, ((side - mw) // 2, (side - mh) // 2), mark)

for path, size in [
    (out_dir / "logo-mark.png", 256),
    (app_dir / "icon.png", 256),
    (app_dir / "apple-icon.png", 256),
]:
    sq.resize((size, size), Image.Resampling.LANCZOS).save(path)
    print("saved", path)

print("mark", mark.size, "cut", cut)
