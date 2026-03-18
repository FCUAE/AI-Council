# LLM Council - Glassmorphism War Room Design Guidelines

## Design Approach
**Aesthetic Direction:** High-tech command center with glassmorphism UI. Taking inspiration from Apple's translucency, sci-fi interfaces, and modern dashboards. The aesthetic is pre-defined: dark slate-950 base with deep gradients, translucent frosted glass cards, and subtle glowing accents.

## Typography System
- **UI/Interface:** Inter (weights: 400, 500, 600, 700)
- **Formal Content/Verdicts:** Merriweather (weights: 400, 700)
- **Scale:** text-sm for labels, text-base for body, text-lg/xl for headings, text-2xl/3xl for phase titles, text-4xl+ for hero

## Layout & Spacing System
**Spacing Primitives:** Use Tailwind units of 2, 4, 6, 8, 12, 16, 20, 24 for consistent rhythm
- Tight spacing: p-4, gap-2
- Standard spacing: p-6, p-8, gap-4
- Generous spacing: p-12, p-16, gap-8
- Section spacing: py-20, py-24

**Container Strategy:**
- Main container: max-w-7xl mx-auto px-6
- Content cards: Full width within container
- Reading content: max-w-4xl for verdict text

## Component Library

### Hero Section
Full viewport height (h-screen) dramatic entry with centered content. Include a high-resolution abstract tech/circuit board background image with dark overlay (bg-slate-950/80). Hero contains:
- Large title (text-5xl/6xl Inter font-bold)
- Subtitle explaining the council concept
- Primary CTA button with backdrop-blur and bg-white/10 background
- Subtle animated gradient overlay pulsing effect

### Phase Cards (Core UI Pattern)
Three distinct cards representing Hearing, Peer Review, and Verdict phases:
- Card structure: bg-white/5, backdrop-blur-md, border border-white/10, rounded-2xl
- Padding: p-8 to p-12
- Glow treatment: Add subtle box-shadow with cyan/blue/purple hues on active phase
- Stack vertically on mobile, horizontal on desktop (grid-cols-1 lg:grid-cols-3 gap-6)

### Model Response Streams (Hearing Phase)
Individual AI model cards within the hearing phase:
- Nested glass cards: bg-white/5, backdrop-blur-sm, border-white/5, p-6
- Model header with icon/avatar + name (Inter font-semibold)
- Streaming text area with monospace font for technical responses
- Loading states: Animated gradient shimmer effect
- Grid: 2-3 columns on desktop (grid-cols-1 md:grid-cols-2 lg:grid-cols-3)

### Critique Cards (Peer Review Phase)
Compact cards displaying model-to-model critiques:
- Each critique: bg-white/5, backdrop-blur-sm, p-4, rounded-xl
- Header: Reviewer model name + target model
- Body: Critique text (text-sm Inter)
- Connection lines: Subtle gradient borders indicating review relationships
- Layout: Masonry or stacked grid showing interconnections

### Chairman Verdict Panel
Prominent centered panel with elevated importance:
- Larger card: bg-white/10, backdrop-blur-lg, border-2 border-white/20, p-12
- Title: "Final Verdict" (Merriweather font-bold text-3xl)
- Content: Synthesis text in Merriweather (text-lg leading-relaxed)
- Accent: Subtle cyan/blue glow around border
- Width: max-w-4xl centered

### Navigation
Top-fixed glass navbar:
- bg-slate-950/80, backdrop-blur-xl, border-b border-white/10
- Logo + phase indicators/breadcrumbs
- Height: h-16, px-6

### Status Indicators
Phase progress visualization:
- Horizontal stepper/timeline showing Hearing → Peer Review → Verdict
- Active phase glows (cyan accent), completed phases dimmed (white/30)
- Icons for each phase with connecting lines
- Position: Below navbar or within hero

### Footer
Minimal glass footer:
- bg-white/5, backdrop-blur-md, border-t border-white/10
- Single row with credits, links (text-sm text-white/60)
- py-8

## Visual Enhancements

**Gradients:**
- Background: Radial gradients from slate-900 to slate-950 with subtle purple/cyan hints
- Cards: Gradient borders (border-image) with cyan-to-purple shifts
- Accents: Glow effects using box-shadow with blur spreads (shadow-cyan-500/20)

**Glass Effect Consistency:**
All interactive cards use: `bg-white/5 backdrop-blur-md border border-white/10`
Elevated/important elements use: `bg-white/10 backdrop-blur-lg border-white/20`

**Micro-interactions:**
- Cards: Subtle scale on hover (transform: scale(1.02))
- Borders: Glow intensity increases on focus/active states
- Text: Smooth opacity transitions for streaming content

## Images

**Hero Background:** 
Abstract technological visualization - circuit boards, neural networks, or data streams. Dark themed with blue/cyan accents. Apply overlay: bg-slate-950/80. Image should be high-resolution, covering full viewport. Position: bg-cover bg-center.

**Optional Phase Illustrations:**
Small iconic images for each phase header (512x512 max) showing conceptual representations - multiple AI avatars for Hearing, interconnected nodes for Peer Review, gavel/scale for Verdict. These are decorative accents, not primary imagery.

## Accessibility
- Maintain 4.5:1 contrast for text-white on glass backgrounds
- Focus indicators: Bright cyan outline (ring-2 ring-cyan-400)
- Semantic HTML structure for phase progression
- ARIA labels for loading states and model identifiers