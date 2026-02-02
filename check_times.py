import os
import time

path = r"c:\Users\nadhi\OneDrive\Desktop\fuse\server\uploads\697cac7a9460ea151757b891"
files = [f for f in os.listdir(path) if os.path.isfile(os.path.join(path, f))]

print(f"{'File':<60} | {'Modified Time':<20} | {'Size':<10}")
print("-" * 100)

for f in sorted(files):
    full_path = os.path.join(path, f)
    mtime = os.path.getmtime(full_path)
    size = os.path.getsize(full_path)
    print(f"{f:<60} | {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(mtime))} | {size:<10}")
