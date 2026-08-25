from PIL import Image, ImageOps, ImageDraw

source = Image.open(r"C:\Users\pchpdani\.codex\generated_images\01a03738-019c-7153-8e23-afea8153d224\exec-c9f2fcf7-4c90-42f5-b95f-e7784f8882e1.png").convert("RGB")
implementation = Image.open("implementation-final.png").convert("RGB")
target = (720, 512)
source = ImageOps.fit(source, target, method=Image.Resampling.LANCZOS)
implementation = ImageOps.fit(implementation, target, method=Image.Resampling.LANCZOS)
canvas = Image.new("RGB", (1440, 548), "#07131d")
canvas.paste(source, (0, 36))
canvas.paste(implementation, (720, 36))
draw = ImageDraw.Draw(canvas)
draw.text((18, 10), "SOURCE — OPTION 2", fill="white")
draw.text((738, 10), "IMPLEMENTATION", fill="white")
canvas.save("design-comparison.png", quality=94)
