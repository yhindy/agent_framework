import time
import sys

print("Working...", flush=True)
time.sleep(1)
print("Do you want to proceed? [y/n] ", end="", flush=True)
# script hangs here reading stdin
try:
    if sys.version_info[0] < 3:
        raw_input()
    else:
        input()
except EOFError:
    pass

