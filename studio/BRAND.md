# Brand book

Two channels, one visual system. Regenerate every asset any time with
`python run.py brand` → `data/brand/<channel>/` (avatar, banner, watermark,
ABOUT.txt with paste-ready copy). Identity text lives in `app/brand.py` (BRANDS).

---

## The signature style: **Starfield Noir**

One look across everything — logo, banner, and every frame of every video.
That consistency is deliberate: it builds feed recognition (viewers learn to stop
scrolling before they read a word) and it reads as a real brand, not mass-produced
content — which is also your inauthentic-content-policy shield.

**Art style (locked):**
| Element | Rule |
|---|---|
| Background | near-black gradient `#050606 → #0B0D0C → #101816` |
| Starfield | tiny white pinpricks, ~16% accent green, rare 4-point sparkles; unique per video (seeded) |
| Accent | `#35E87A` — the ONLY color besides white/near-black. Money, growth, highlights |
| Text | **Roboto Black** (bundled in assets/fonts, Apache 2.0) for display + captions, Roboto Bold for labels; captions ALL CAPS with heavy outline + drop shadow; white body, accent for emphasis; numbers always accent, oversized, with glow |
| Graphics | flat vector shapes with glow strokes — charts, rings, timelines, silhouettes |
| Photos | real archival images as framed, tilted photo-cards — **Wikimedia Commons only** (public domain / CC-BY / CC-BY-SA, never NC/ND), auto-credited in the description. Real people appear via licensed photos, never stock filler |
| Emoji | real color emoji as punctuation, 1 per scene, amplifying emotion not decorating |

**Video style (locked):**
| Element | Rule |
|---|---|
| Structure | HOOK (card at frame 0) → 3–6 beats → PAYOFF → LOOP; 20–35s |
| Cuts | hard cut per beat, punch-in settle (1.14→1.02 in 6 frames), alternating drift |
| Captions | 1–3 word karaoke chunks, center band, bounce-in, numbers 22% bigger |
| Emoji layer | pops in under captions with drop-and-bob, per spoken segment |
| Sound | whoosh under every cut, pop on emoji land, voice loudness −14 LUFS |
| Voice | one consistent voice per channel, ~1.08× pace |

**Don'ts:** no third color, no stock-footage filler, no unlicensed images (the
image engine only accepts PD/CC-BY/CC-BY-SA from Commons), no music beds until
we A/B them, no breaking the caption center band, no more than 2 emoji on screen
at once.

---

## Channel A — Broke to Billions  💸

- **Positioning:** the money-story channel with receipts. Real people, real numbers,
  real timelines — the moment every fortune almost didn't happen.
- **Logomark:** the *escape trajectory* — an ascending chart line breaking out of a
  ring. It's the `chart_up` scene distilled into an icon.
- **Handle:** `@BrokeToBillions` (verify availability; alternates: `@Broke2Billions`,
  `@BrokeToBillionsDaily`, `@FromBrokeToBillions`)
- **Tagline:** "How they got rich — in 30 seconds."
- **Voice/tone:** calm, precise, a storyteller who respects the viewer's intelligence.
  Numbers do the shouting; the narrator never does.
- **Title convention:** `<person/company> + <the impossible-sounding number or reversal>`
  — e.g. "Broke at 44. Richest man in America by 67."
- **Content pillars:** rags-to-riches timelines · the one decision that made the
  fortune · money mistakes billionaires made first · "priced below everyone" mechanics

## Channel B — Brain Glitch  🧠

- **Positioning:** the bugs in human wiring, one glitch a day. Psychology that feels
  like finding a cheat code.
- **Logomark:** the *glitched ring* — a circle whose middle slice is displaced, with
  the dot knocked off-center.
- **Handle:** `@TheBrainGlitch` (alternates: `@BrainGlitchDaily`, `@BrainGlitchShorts`)
- **Tagline:** "Your brain is lying to you."
- **Voice/tone:** playful, sharp, slightly mischievous — the friend who tells you the
  trick after showing you the magic.
- **Title convention:** `<the glitch> + <where it costs you>` — e.g. "Your memory
  rewrites itself every time you use it."
- **Content pillars:** memory glitches · pricing/persuasion tricks · habit mechanics ·
  perception failures

## Why one visual system across two brands

The channels share the Starfield Noir skin but differ in mark, name, voice, and
content. If analytics later show audience confusion (or you want a second visual
identity), Brain Glitch can switch to any theme in `visuals.py` plus its own accent
in one config line — the whole brand kit regenerates in seconds.

## Applying the brand (launch checklist addition)

1. `python run.py brand`
2. YouTube Studio → Customization → Branding: upload `avatar.png`, `banner.png`,
   `watermark.png` (watermark display: end of video)
3. Customization → Basic info: paste name, handle, and the description from `ABOUT.txt`
4. Settings → Upload defaults: category Education, not made for kids, altered content: yes
