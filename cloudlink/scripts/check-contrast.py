import re, sys
# Verify DESIGN.md text pairs ≥ 4.5:1 using tokens from src/index.css (OKLCH → sRGB → WCAG)
css = open(sys.argv[1], encoding='utf-8').read()
def block(sel):
    m = re.search(re.escape(sel) + r' \{(.*?)\n\}', css, re.S); return dict(re.findall(r'--([\w-]+): oklch\(([^)]*)\);', m.group(1)))
def rgb(v):
    p = v.split('/')[0].split(); L, C, H = float(p[0]), float(p[1]), float(p[2])
    import math
    a, b = C * math.cos(math.radians(H)), C * math.sin(math.radians(H))
    l_ = L + 0.3963377774 * a + 0.2158037573 * b; m_ = L - 0.1055613458 * a - 0.0638541728 * b; s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return [min(1, max(0, x)) for x in (r, g, bb)]
def lum(c): return sum(w * c_ for w, c_ in zip((0.2126, 0.7152, 0.0722), c))  # linear already
def ratio(a, b):
    x, y = lum(rgb(a)) + 0.05, lum(rgb(b)) + 0.05; return max(x, y) / min(x, y)
PAIRS = [('foreground', 'card'), ('foreground', 'background'), ('fg-2', 'card'), ('muted-foreground', 'card'), ('muted-foreground', 'background'),
         ('ctl-fg', 'pill'), ('signal', 'card'), ('success', 'card'), ('warning', 'card'), ('destructive', 'card'), ('primary-foreground', 'ink'), ('foreground', 'pill')]
bad = 0
for sel in [':root', '.dark']:
    t = block(sel)
    for f, b in PAIRS:
        r = ratio(t[f], t[b]); ok = r >= 4.5; bad += not ok
        print(f'{sel:6} {f:20} on {b:12} {r:5.2f} {"OK" if ok else "FAIL"}')
sys.exit(1 if bad else 0)
