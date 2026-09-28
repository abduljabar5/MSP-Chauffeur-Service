#!/usr/bin/env python3
"""Generate MSP Chauffeur Service service pages from specs, using the site skeleton."""
import os, re, json, html
from PIL import Image

ROOT = '/Users/abduljabarnur/limosite'
os.chdir(ROOT)
SITE = 'https://mspairportchauffeur.com'
PHONE = '(612) 666-5004'; TEL = 'tel:+16126665004'
BG = 'images/photos/fbo-yukon-jet.webp'

def dims(path, default=(1600, 900)):
    try:
        with Image.open(path) as im: return im.size
    except Exception: return default

def esc(s): return html.escape(s, quote=True)

# ---------- skeleton from an existing page ----------
SKEL='airport-pickup.html'
src = open(SKEL).read()
head = src[:src.index('<body')]
body_start = src.index('<body')
main_start = src.index('<main id="main-content">')
main_end = src.index('</main>') + len('</main>')
header_html = src[body_start:main_start]
footer_html = src[main_end:]
# strip the old ld+json blocks from head; we generate our own
head = re.sub(r'\s*<!-- Structured Data: [^\n]*\n\s*<script type="application/ld\+json">.*?</script>', '', head, flags=re.S)

ARROW = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>'
PHONE_SVG = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>'

def hero(p):
    w, h = dims(BG)
    return f'''
        <!-- ================= HERO ================= -->
        <section class="relative pt-40 lg:pt-56 pb-24 lg:pb-32 overflow-hidden page-hero">
            <div class="absolute inset-0">
                <img src="{BG}" alt="" class="absolute inset-0 w-full h-full object-cover object-[center_60%]" width="{w}" height="{h}" fetchpriority="high" aria-hidden="true">
                <div class="absolute inset-0 bg-gradient-to-b from-lacquer-950/85 via-lacquer-950/70 to-lacquer-950"></div>
                <div class="absolute inset-0 bg-gradient-to-r from-lacquer-950/80 via-transparent to-transparent"></div>
            </div>
            <div class="container mx-auto px-6 lg:px-8 relative z-10">
                <div class="max-w-3xl">
                    <div class="eyebrow mb-6">{esc(p['eyebrow'])}</div>
                    <h1 class="text-4xl sm:text-5xl lg:text-6xl font-display leading-[1.12] text-ivory-100 mb-6">{p['h1']}</h1>
                    <p class="text-lg lg:text-xl text-lacquer-200 font-light leading-relaxed mb-9 max-w-2xl">{p['lede']}</p>
                    <div class="flex flex-col sm:flex-row gap-4">
                        <a href="book-a-ride.html{p.get('book_qs','')}" class="btn-carmine"><span>{esc(p.get('cta1','Book Now'))}</span>{ARROW}</a>
                        <a href="{TEL}" class="btn-ghost">{PHONE_SVG}<span>Call Dispatch 24/7</span></a>
                    </div>
                </div>
            </div>
        </section>
'''

def section_intro(p):
    img = p['image']; w, h = dims(img)
    paras = ''.join(f'<p class="text-lacquer-300 font-light leading-relaxed mb-5">{t}</p>' for t in p['intro'])
    return f'''
        <!-- ================= INTRO ================= -->
        <section class="py-20 lg:py-24 bg-lacquer-950 border-t border-brass-400/10">
            <div class="container mx-auto px-6 lg:px-8">
                <div class="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">
                    <div class="lg:col-span-5 reveal">
                        <div class="eyebrow mb-6">{esc(p['intro_eyebrow'])}</div>
                        <h2 class="text-3xl lg:text-4xl font-display text-ivory-100 mb-6 leading-snug">{p['intro_h2']}</h2>
                        {paras}
                    </div>
                    <div class="lg:col-span-7 relative reveal">
                        <div class="plate p-3 bg-lacquer-850">
                            <img src="{img}" alt="{esc(p['image_alt'])}" class="block w-full" width="{w}" height="{h}" loading="lazy">
                        </div>
                        <div class="mt-5 text-center"><span class="caption-plate">{esc(p['image_caption'])}</span></div>
                    </div>
                </div>
            </div>
        </section>
'''

def section_bullets(p):
    cards = ''.join(f'''
                    <div class="plate bg-lacquer-850/50 p-7 reveal">
                        <h3 class="text-lg font-display text-ivory-100 mb-3">{esc(t)}</h3>
                        <p class="text-lacquer-300 font-light text-sm leading-relaxed">{d}</p>
                    </div>''' for t, d in p['bullets'])
    cols = 'md:grid-cols-2 lg:grid-cols-3' if len(p['bullets']) != 4 else 'md:grid-cols-2 lg:grid-cols-4'
    return f'''
        <!-- ================= WHY ================= -->
        <section class="py-20 lg:py-24 bg-gradient-to-b from-lacquer-950 via-lacquer-900/60 to-lacquer-950">
            <div class="container mx-auto px-6 lg:px-8">
                <div class="text-center max-w-2xl mx-auto mb-14 reveal">
                    <div class="eyebrow mb-6">{esc(p['bullets_eyebrow'])}</div>
                    <h2 class="text-3xl lg:text-4xl font-display text-ivory-100 mb-5">{p['bullets_h2']}</h2>
                    {('<p class="text-lacquer-300 font-light">'+p['bullets_lede']+'</p>') if p.get('bullets_lede') else ''}
                </div>
                <div class="grid {cols} gap-6">{cards}
                </div>
            </div>
        </section>
'''

ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI']
def section_steps(p):
    if not p.get('steps'): return ''
    cards = ''.join(f'''
                    <div class="plate bg-lacquer-850/50 p-7 reveal">
                        <div class="text-3xl font-display text-brass-300 mb-3">{ROMAN[i]}.</div>
                        <h3 class="text-lg font-display text-ivory-100 mb-3">{esc(t)}</h3>
                        <p class="text-lacquer-300 font-light text-sm leading-relaxed">{d}</p>
                    </div>''' for i, (t, d) in enumerate(p['steps']))
    n = len(p['steps']); cols = {3:'md:grid-cols-3',4:'md:grid-cols-2 lg:grid-cols-4',5:'md:grid-cols-2 lg:grid-cols-5'}.get(n,'md:grid-cols-2 lg:grid-cols-4')
    return f'''
        <!-- ================= HOW IT WORKS ================= -->
        <section class="py-20 lg:py-24 bg-lacquer-950 border-t border-brass-400/10">
            <div class="container mx-auto px-6 lg:px-8">
                <div class="text-center max-w-2xl mx-auto mb-14 reveal">
                    <div class="eyebrow mb-6">{esc(p.get('steps_eyebrow','The Procedure'))}</div>
                    <h2 class="text-3xl lg:text-4xl font-display text-ivory-100 mb-5">{p['steps_h2']}</h2>
                </div>
                <div class="grid {cols} gap-5">{cards}
                </div>
            </div>
        </section>
'''

FLEET = [
    ('Premium SUV', 'Cadillac Escalade', '1–6 passengers · 6 bags', 'From $90', 'images/fleet/suv-escalade.webp'),
    ('SUV', 'GMC Yukon Denali', '1–7 passengers · 6 bags', 'From $75', 'images/fleet/suv-gmc-yukon.webp'),
    ('Sedan', 'Lincoln Continental', '1–3 passengers · 4 bags', 'From $60', 'images/fleet/sedan-lincoln.webp'),
    ('Sprinter Van', 'Mercedes-Benz Sprinter', '1–15 passengers · 15 bags', 'From $160', 'images/fleet/van-sprinter.webp'),
]
def section_fleet(p):
    cards = ''
    for name, model, cap, price, img in FLEET:
        w, h = dims(img, (1200, 900))
        cards += f'''
                    <a href="fleet.html" class="group plate bg-lacquer-850/60 overflow-hidden hover:bg-lacquer-850 transition-all duration-500 reveal">
                        <div class="aspect-[4/3] relative overflow-hidden bg-[#0e0f12]">
                            <img src="{img}" alt="{esc(model)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" width="{w}" height="{h}" loading="lazy">
                            <div class="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-lacquer-850/80 to-transparent pointer-events-none"></div>
                        </div>
                        <div class="p-5 border-t border-brass-400/15">
                            <h3 class="text-lg font-display text-ivory-100">{esc(name)}</h3>
                            <p class="text-xs text-lacquer-400 mb-2">{esc(model)}</p>
                            <p class="text-sm text-lacquer-300 font-light">{esc(cap)}</p>
                            <p class="text-oxblood-300 font-semibold mt-3">{esc(price)}</p>
                        </div>
                    </a>'''
    return f'''
        <!-- ================= FLEET ================= -->
        <section class="py-20 lg:py-24 bg-gradient-to-b from-lacquer-950 via-lacquer-900/60 to-lacquer-950">
            <div class="container mx-auto px-6 lg:px-8">
                <div class="text-center max-w-2xl mx-auto mb-12 reveal">
                    <div class="eyebrow mb-6">The Fleet</div>
                    <h2 class="text-3xl lg:text-4xl font-display text-ivory-100 mb-5">{p.get('fleet_h2','Sized to the Trip, Not the Other Way Around')}</h2>
                    <p class="text-lacquer-300 font-light">{p.get('fleet_lede','Tell us your passenger and luggage count and we will recommend the right one. Every vehicle is late-model, non-smoking, detailed before each pickup, and fully licensed and insured for commercial passenger transport.')}</p>
                </div>
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-6">{cards}
                </div>
            </div>
        </section>
'''

def section_faq(p):
    items = ''.join(f'''
                    <details class="plate bg-lacquer-850/60">
                        <summary class="flex items-center justify-between gap-4 px-6 py-5">
                            <span class="text-ivory-100 font-medium">{esc(q)}</span>
                            <span class="faq-icon text-brass-400 text-xl leading-none shrink-0">+</span>
                        </summary>
                        <div class="px-6 pb-6 -mt-1"><p class="text-lacquer-300 font-light text-sm leading-relaxed">{a}</p></div>
                    </details>''' for q, a in p['faq'])
    return f'''
        <!-- ================= FAQ ================= -->
        <section class="py-20 lg:py-24 bg-lacquer-950 border-t border-brass-400/10">
            <div class="container mx-auto px-6 lg:px-8">
                <div class="text-center max-w-2xl mx-auto mb-12 reveal">
                    <div class="eyebrow mb-6">Questions, Answered</div>
                    <h2 class="text-3xl lg:text-4xl font-display text-ivory-100">{esc(p.get('faq_h2','Frequently Asked Questions'))}</h2>
                </div>
                <div class="max-w-3xl mx-auto space-y-4 reveal">{items}
                </div>
            </div>
        </section>
'''

def section_related(p):
    links = ''.join(f'''
                    <a href="{href}" class="group plate bg-lacquer-850/50 p-6 hover:bg-lacquer-850/90 transition-all duration-500 reveal flex items-center justify-between gap-4">
                        <div><h3 class="text-lg font-display text-ivory-100 mb-1">{esc(t)}</h3><p class="text-lacquer-300 font-light text-sm">{d}</p></div>
                        <svg class="w-5 h-5 text-lacquer-500 group-hover:text-oxblood-300 group-hover:translate-x-1 transition-all duration-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
                    </a>''' for href, t, d in p['related'])
    return f'''
        <!-- ================= RELATED ================= -->
        <section class="py-20 lg:py-24 bg-gradient-to-b from-lacquer-950 via-lacquer-900/60 to-lacquer-950">
            <div class="container mx-auto px-6 lg:px-8">
                <div class="text-center max-w-2xl mx-auto mb-12 reveal">
                    <div class="eyebrow mb-6">Related Services</div>
                    <h2 class="text-3xl lg:text-4xl font-display text-ivory-100">More Ways We Drive the Twin Cities</h2>
                </div>
                <div class="grid md:grid-cols-2 gap-5 max-w-4xl mx-auto">{links}
                </div>
            </div>
        </section>
'''

def section_cta(p):
    w, h = dims('images/site/interior.webp')
    return f'''
        <!-- ================= CTA ================= -->
        <section class="py-24 lg:py-32 relative overflow-hidden">
            <img src="images/site/interior.webp" alt="" class="absolute inset-0 w-full h-full object-cover" width="{w}" height="{h}" loading="lazy" aria-hidden="true">
            <div class="absolute inset-0 bg-gradient-to-br from-oxblood-800/90 via-oxblood-700/85 to-lacquer-950/95"></div>
            <div class="absolute inset-0 bg-[linear-gradient(rgba(15,12,10,0.25)_1px,transparent_1px),linear-gradient(90deg,rgba(15,12,10,0.25)_1px,transparent_1px)] bg-[size:90px_90px]"></div>
            <div class="container mx-auto px-6 lg:px-8 relative z-10">
                <div class="max-w-3xl mx-auto text-center reveal">
                    <div class="divider-diamond mb-6 text-ivory-200/70">◆</div>
                    <h2 class="text-3xl lg:text-5xl font-display text-ivory-100 mb-6">{p['cta_h2']}</h2>
                    <p class="text-lg text-ivory-200/80 font-light mb-10">{p['cta_p']}</p>
                    <div class="flex flex-col sm:flex-row gap-4 justify-center">
                        <a href="book-a-ride.html{p.get('book_qs','')}" class="btn-carmine !bg-none !bg-lacquer-950 hover:!bg-lacquer-900"><span>{esc(p.get('cta1','Book Now'))}</span>{ARROW}</a>
                        <a href="{TEL}" class="btn-ghost !border-ivory-100/40 !text-ivory-100 hover:!bg-ivory-100/10">{PHONE_SVG}<span>{PHONE}</span></a>
                    </div>
                </div>
            </div>
        </section>
'''

def ld(p):
    service = {
        "@context": "https://schema.org", "@type": "Service", "serviceType": p['service_type'], "name": p['title_short'],
        "description": p['meta'], "url": f"{SITE}/{p['file']}",
        "provider": {"@type": "LocalBusiness", "@id": f"{SITE}/#business", "name": "MSP Chauffeur Service", "telephone": "+1-612-666-5004", "url": SITE},
        "areaServed": [{"@type": "City", "name": "Minneapolis"}, {"@type": "City", "name": "Saint Paul"}, {"@type": "State", "name": "Minnesota"}],
        "hoursAvailable": {"@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"], "opens": "00:00", "closes": "23:59"}
    }
    faq = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": re.sub('<[^>]+>', '', a)}} for q, a in p['faq']]}
    return ('    <!-- Structured Data: Service -->\n    <script type="application/ld+json">\n' + json.dumps(service, indent=4) +
            '\n    </script>\n    <!-- Structured Data: FAQ -->\n    <script type="application/ld+json">\n' + json.dumps(faq, indent=4) + '\n    </script>\n')

def build(p):
    h = head
    h = re.sub(r'<title>.*?</title>', f'<title>{esc(p["title"])}</title>', h)
    h = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{esc(p["meta"])}">', h)
    h = re.sub(r'<meta name="keywords" content="[^"]*">', f'<meta name="keywords" content="{esc(p["keywords"])}">', h)
    h = h.replace(SKEL, p['file'])
    h = re.sub(r'<meta property="og:title" content="[^"]*">', f'<meta property="og:title" content="{esc(p["title"])}">', h)
    h = re.sub(r'<meta property="og:description" content="[^"]*">', f'<meta property="og:description" content="{esc(p["meta"])}">', h)
    h = re.sub(r'<meta name="twitter:title" content="[^"]*">', f'<meta name="twitter:title" content="{esc(p["title"])}">', h)
    h = re.sub(r'<meta name="twitter:description" content="[^"]*">', f'<meta name="twitter:description" content="{esc(p["meta"])}">', h)
    h = re.sub(r'(<meta property="og:image" content=")[^"]*(">)', lambda m: m.group(1)+SITE+'/'+p['image']+m.group(2), h)
    h = re.sub(r'(<meta name="twitter:image" content=")[^"]*(">)', lambda m: m.group(1)+SITE+'/'+p['image']+m.group(2), h)
    h = h.rstrip() + '\n\n' + ld(p) + '</head>\n' if '</head>' not in h.rstrip()[-10:] else h.replace('</head>', ld(p) + '</head>')
    main = '<main id="main-content">' + hero(p) + section_intro(p) + section_bullets(p) + section_steps(p) + section_fleet(p) + section_faq(p) + section_related(p) + section_cta(p) + '\n    </main>'
    out = h + header_html + main + footer_html
    open(p['file'], 'w').write(out)
    return p['file']

if __name__ == '__main__':
    import importlib.util, sys
    spec = importlib.util.spec_from_file_location('specs', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'page_specs.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    for p in m.PAGES:
        print('built', build(p))
