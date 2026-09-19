#!/usr/bin/env python3
"""Generate 69 unique themes with coherent light/dark palettes from HSL base."""
import json, os, sys

THEMES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "themes")

def clamp(v, lo=0, hi=255):
    return max(lo, min(hi, int(round(v))))

def hsl2rgb(h, s, l):
    h = h % 360; s /= 100.0; l /= 100.0
    c = (1 - abs(2*l - 1)) * s
    x = c * (1 - abs((h/60) % 2 - 1))
    m = l - c/2
    if h < 60:    r,g,b = c,x,0
    elif h < 120: r,g,b = x,c,0
    elif h < 180: r,g,b = 0,c,x
    elif h < 240: r,g,b = 0,x,c
    elif h < 300: r,g,b = x,0,c
    else:         r,g,b = c,0,x
    return clamp((r+m)*255), clamp((g+m)*255), clamp((b+m)*255)

def hex_c(h,s,l): r,g,b = hsl2rgb(h,s,l); return "#{:02X}{:02X}{:02X}".format(r,g,b)
def rgb_c(h,s,l): r,g,b = hsl2rgb(h,s,l); return "{}, {}, {}".format(r,g,b)

def make_theme(name, desc, h, s):
    """Create coherent theme from base hue and saturation."""
    ha = (h + 15) % 360
    hb1 = (h + 45) % 360
    hb2 = (h + 95) % 360
    hb3 = (h + 150) % 360
    hb4 = (h + 230) % 360
    
    return {
        "name": name,
        "description": desc,
        "light": {
            "--aurora-1": hex_c(h, s, 62),
            "--aurora-1-rgb": rgb_c(h, s, 62),
            "--aurora-2": hex_c(ha, s, 52),
            "--aurora-2-rgb": rgb_c(ha, s, 52),
            "--aurora-accent": hex_c(ha, min(s+10,100), 28),
            "--aurora-accent-rgb": rgb_c(ha, min(s+10,100), 28),
            "--bg-base": hex_c(h, max(s-45,3), 97),
            "--aurora-card-base": hex_c(h, max(s-18,5), 88),
            "--text-primary": hex_c(h, max(s-55,5), 12),
            "--text-secondary": hex_c(h, max(s-35,5), 32),
            "--text-muted": hex_c(h, max(s-25,5), 48),
            "--surface-glass": "rgba(var(--glass-tint-rgb), 0.78)",
            "--surface-elevated": "rgba(var(--glass-lift-rgb), 0.88)",
            "--surface-card": "rgba({}, {}, {}, 0.92)".format(*hsl2rgb(h, max(s-12,5), 90)),
            "--glass-tint-rgb": rgb_c(h, s, 70),
            "--glass-lift-rgb": rgb_c(h, max(s-18,5), 94),
            "--caret-glow": hex_c((h+35)%360, min(s+20,100), 58),
            "--sweden-blue": "#A2A62F",
            "--sweden-yellow": "#D4AE4A",
            "--sweden-yellow-rgb": "212, 174, 74",
            "--blob-a-rgb": rgb_c(hb1, min(s+10,100), 55),
            "--blob-b-rgb": rgb_c(hb2, min(s+5,100), 50),
            "--blob-c-rgb": rgb_c(hb3, min(s+10,100), 55),
            "--blob-d-rgb": rgb_c(hb4, min(s+5,100), 50),
            "--diff-correct-text": "#2E6B44",
            "--diff-correct-border": "#5FA876",
            "--diff-wrong-text": "#9C4232",
            "--diff-wrong-border": "#C4715F",
            "--diff-fixed-text": "#3A5A8A",
            "--diff-fixed-border": "#6E8FC2",
            "--diff-orange-text": "#805D20",
            "--diff-orange-border": "#C4751A"
        },
        "dark": {
            "--aurora-1": hex_c(h, max(s-10,15), 28),
            "--aurora-1-rgb": rgb_c(h, max(s-10,15), 28),
            "--aurora-2": hex_c(ha, max(s-10,15), 20),
            "--aurora-2-rgb": rgb_c(ha, max(s-10,15), 20),
            "--aurora-accent": hex_c(ha, max(s-5,15), 58),
            "--aurora-accent-rgb": rgb_c(ha, max(s-5,15), 58),
            "--bg-base": hex_c(h, max(s-55,3), 6),
            "--aurora-card-base": hex_c(h, max(s-40,3), 9),
            "--text-primary": hex_c(h, max(s-45,3), 94),
            "--text-secondary": hex_c(h, max(s-30,5), 78),
            "--text-muted": hex_c(h, max(s-18,5), 55),
            "--surface-glass": "rgba(var(--glass-tint-rgb), 0.78)",
            "--surface-elevated": "rgba(var(--glass-lift-rgb), 0.88)",
            "--surface-card": "rgba({}, {}, {}, 0.92)".format(*hsl2rgb(h, max(s-12,3), 10)),
            "--glass-tint-rgb": rgb_c(h, max(s-12,10), 25),
            "--glass-lift-rgb": rgb_c(h, max(s-28,3), 12),
            "--caret-glow": hex_c((h+35)%360, min(s+15,100), 52),
            "--sweden-blue": "#C7C54F",
            "--sweden-yellow": "#E8C568",
            "--sweden-yellow-rgb": "232, 197, 104",
            "--blob-a-rgb": rgb_c(hb1, min(s+5,100), 38),
            "--blob-b-rgb": rgb_c(hb2, s, 32),
            "--blob-c-rgb": rgb_c(hb3, min(s+5,100), 38),
            "--blob-d-rgb": rgb_c(hb4, s, 32),
            "--diff-correct-text": "#B9F0D6",
            "--diff-correct-border": "#34D399",
            "--diff-wrong-text": "#FFD3C8",
            "--diff-wrong-border": "#F08A7C",
            "--diff-fixed-text": "#A8C6F0",
            "--diff-fixed-border": "#6E9EE0",
            "--diff-orange-text": "#F5E3B0",
            "--diff-orange-border": "#E8963A"
        }
    }

# 69 curated unique themes — (slug, name, description, hue, sat)
NEW_THEMES = [
    ("abyssal-blue",       "Abyssal Blue",       "Vuc sau dai duong xanh tham", 215, 70),
    ("pacific-cyan",       "Pacific Cyan",       "Thai Binh duong xanh ngoc", 185, 75),
    ("coral-reef",         "Coral Reef",         "San ho ngoai khoi", 5, 80),
    ("deep-lagoon",        "Deep Lagoon",        "Dam phu xanh sau", 195, 65),
    ("bioluminescent",     "Bioluminescent",     "Anh sang sinh hoc", 170, 85),
    ("volcanic-ash",       "Volcanic Ash",       "Tro nui lua", 0, 12),
    ("redwood-bark",       "Redwood Bark",       "Vo cay go do", 12, 48),
    ("moss-stone",         "Moss Stone",         "Da phu reu", 95, 38),
    ("canyon-rust",        "Canyon Rust",        "Ri set khe nui", 18, 62),
    ("alpine-snow",        "Alpine Snow",        "Tuyet nui cao", 210, 18),
    ("turmeric-gold",      "Turmeric Gold",      "Vang nghe", 42, 88),
    ("paprika-red",        "Paprika Red",        "Do ot paprika", 8, 72),
    ("saffron-silk",       "Saffron Silk",       "Lua nghe tay", 38, 82),
    ("cinnamon-bark",      "Cinnamon Bark",      "Que thanh", 22, 58),
    ("cardamom-green",     "Cardamom Green",     "Thao qua xanh", 145, 52),
    ("wisteria-rain",      "Wisteria Rain",      "Mua hoa tu dang", 265, 58),
    ("sunflower-field",    "Sunflower Field",    "Canh dong huong duong", 48, 88),
    ("lotus-pool",         "Lotus Pool",         "Dam sen hong", 335, 58),
    ("jasmine-white",      "Jasmine White",      "Hoa nhai trang", 55, 22),
    ("iris-purple",        "Iris Purple",        "Hoa dien vi tim", 275, 62),
    ("sapphire-deep",      "Sapphire Deep",      "Xanh bich ngoc", 225, 78),
    ("emerald-cut",        "Emerald Cut",        "Ngoc luc bao", 150, 72),
    ("ruby-glow",          "Ruby Glow",          "Anh hong ngoc", 348, 68),
    ("topaz-warm",         "Topaz Warm",         "Hoang ngoc am", 35, 76),
    ("amethyst-haze",      "Amethyst Haze",      "Suong tu thach anh", 280, 52),
    ("aurora-borealis",    "Aurora Borealis",    "Bac cuc quang", 140, 78),
    ("twilight-pink",      "Twilight Pink",      "Tim hong chap choang", 320, 52),
    ("nimbus-gray",        "Nimbus Gray",        "May mua xam", 225, 20),
    ("golden-hour",        "Golden Hour",        "Gio vang nam", 32, 86),
    ("starless-night",     "Starless Night",     "Dem khong sao", 240, 28),
    ("neon-cyber",         "Neon Cyber",         "Neon mang do thi", 290, 88),
    ("retrowave",          "Retrowave",          "Song hoai co 80s", 315, 78),
    ("vaporwave",          "Vaporwave",          "Song hoi tren noi", 195, 58),
    ("pixel-mint",         "Pixel Mint",         "Bac ha ky thuat so", 155, 68),
    ("glitch-red",         "Glitch Red",         "Do nhieu dong", 355, 82),
    ("kyoto-bamboo",       "Kyoto Bamboo",       "Tre Kyoto xanh", 85, 42),
    ("sahara-dune",        "Sahara Dune",        "Doi cat Sahara", 32, 52),
    ("fjord-blue",         "Fjord Blue",         "Vinh Ha Long Bac Au", 200, 58),
    ("tuscany-olive",      "Tuscany Olive",      "O liu Tuscany", 72, 48),
    ("marrakech-terra",    "Marrakech Terracotta","Gach nung Marrakech", 15, 62),
    ("matcha-latte",       "Matcha Latte",       "Tra xanh sua", 108, 42),
    ("espresso-shot",      "Espresso Shot",      "Ca phe den dac", 25, 52),
    ("blueberry-jam",      "Blueberry Jam",      "Mut viet quat", 245, 58),
    ("mango-sorbet",       "Mango Sorbet",       "Kem xoai tuoi", 40, 82),
    ("pistachio-cream",    "Pistachio Cream",    "Kem dau phon", 95, 48),
    ("silk-ivory",         "Silk Ivory",         "Lua nga trang", 40, 20),
    ("velvet-noir",        "Velvet Noir",        "Nhung den huyen", 260, 22),
    ("linen-beige",        "Linen Beige",        "Vai lanh be", 35, 28),
    ("tartan-red",         "Tartan Red",         "Ka-ro do Scotland", 355, 58),
    ("chambray-wash",      "Chambray Wash",      "Vai chambray giat", 210, 38),
    ("cherry-spring",      "Cherry Spring",      "Mua xuan anh dao", 340, 62),
    ("monsoon-teal",       "Monsoon Teal",       "Mua mua xanh", 178, 52),
    ("harvest-gold",       "Harvest Gold",       "Thu hoach vang", 42, 72),
    ("frost-december",     "Frost December",     "Suong gia thang 12", 200, 24),
    ("midsummer-green",    "Midsummer Green",    "Ha chi xanh tuoi", 110, 62),
    ("copper-patina",      "Copper Patina",      "Dong xanh ri set", 165, 42),
    ("gunmetal-chrome",    "Gunmetal Chrome",    "Thep sung bong", 215, 14),
    ("bronze-age",         "Bronze Age",         "Thoi ky do dong", 28, 58),
    ("titanium-silver",    "Titanium Silver",    "Bac titan", 220, 10),
    ("rose-gold-foil",     "Rose Gold Foil",     "La vang hong", 10, 48),
    ("fairy-dust",         "Fairy Dust",         "Bui tien nhan", 290, 62),
    ("dragon-scale",       "Dragon Scale",       "Vay rong xanh", 160, 72),
    ("enchanted-moss",     "Enchanted Moss",     "Reu ma thuat", 130, 48),
    ("phoenix-flame",      "Phoenix Flame",      "Lua phuong hoang", 20, 88),
    ("ink-wash",           "Ink Wash",           "Hoa muc tau", 220, 18),
    ("terracotta-sun",     "Terracotta Sun",     "Gach nung mat troi", 18, 68),
    ("nordic-pine",        "Nordic Pine",        "Thong Bac Au", 148, 48),
    ("desert-rose",        "Desert Rose",        "Hoa hong sa mac", 345, 52),
    ("ocean-mist",         "Ocean Mist",         "Suong bien khoi", 190, 32),
]

def main():
    os.makedirs(THEMES_DIR, exist_ok=True)
    existing = set(f[:-5] for f in os.listdir(THEMES_DIR) if f.endswith('.json') and not f.startswith('_'))
    print("Existing themes:", len(existing))
    created = 0
    for slug, name, desc, hue, sat in NEW_THEMES:
        if slug in existing:
            print("  [skip]", slug)
            continue
        theme = make_theme(name, desc, hue, sat)
        with open(os.path.join(THEMES_DIR, slug + ".json"), "w", encoding="utf-8") as f:
            json.dump(theme, f, indent=2, ensure_ascii=False)
        created += 1
        print("  [+]  ", slug)
    total = len([f for f in os.listdir(THEMES_DIR) if f.endswith('.json') and not f.startswith('_')])
    print("\nCreated {} new themes. Total: {}".format(created, total))

if __name__ == "__main__":
    main()
